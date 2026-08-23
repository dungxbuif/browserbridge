package drive

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultDriveUploadURL = "https://www.googleapis.com/upload/drive/v3/files"
	defaultTokenURL       = "https://oauth2.googleapis.com/token"
)

type UploadMetadata struct {
	Name      string
	MIMEType  string
	FolderID  string
	TotalSize int64
}

type File struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MIMEType    string `json:"mimeType"`
	Size        string `json:"size"`
	WebViewLink string `json:"webViewLink"`
}

type ChunkResult struct {
	Complete   bool
	NextOffset int64
	File       *File
}

type Uploader interface {
	CreateUpload(context.Context, UploadMetadata) (string, error)
	UploadChunk(context.Context, string, []byte, int64, int64) (ChunkResult, error)
}

type TokenSource interface {
	Token(context.Context) (string, error)
}

type StaticTokenSource struct {
	AccessToken string
}

func (s StaticTokenSource) Token(context.Context) (string, error) {
	if strings.TrimSpace(s.AccessToken) == "" {
		return "", errors.New("google drive access token is empty")
	}
	return s.AccessToken, nil
}

type RefreshTokenSource struct {
	ClientID     string
	ClientSecret string
	RefreshToken string
	TokenURL     string
	HTTPClient   *http.Client

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

func (s *RefreshTokenSource) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	if s.token != "" && time.Now().Before(s.expiresAt.Add(-time.Minute)) {
		token := s.token
		s.mu.Unlock()
		return token, nil
	}
	s.mu.Unlock()

	values := url.Values{}
	values.Set("client_id", s.ClientID)
	values.Set("client_secret", s.ClientSecret)
	values.Set("refresh_token", s.RefreshToken)
	values.Set("grant_type", "refresh_token")

	tokenURL := s.TokenURL
	if tokenURL == "" {
		tokenURL = defaultTokenURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("google oauth refresh failed: status %d", resp.StatusCode)
	}

	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if parsed.AccessToken == "" {
		return "", errors.New("google oauth response did not include access_token")
	}
	expiresIn := parsed.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}

	s.mu.Lock()
	s.token = parsed.AccessToken
	s.expiresAt = time.Now().Add(time.Duration(expiresIn) * time.Second)
	s.mu.Unlock()
	return parsed.AccessToken, nil
}

type Client struct {
	HTTPClient  *http.Client
	TokenSource TokenSource
	UploadURL   string
}

func (c *Client) CreateUpload(ctx context.Context, meta UploadMetadata) (string, error) {
	if err := validateMetadata(meta); err != nil {
		return "", err
	}
	token, err := c.token(ctx)
	if err != nil {
		return "", err
	}

	body := map[string]any{
		"name":     meta.Name,
		"mimeType": meta.MIMEType,
	}
	if strings.TrimSpace(meta.FolderID) != "" {
		body["parents"] = []string{meta.FolderID}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return "", err
	}

	uploadURL := c.UploadURL
	if uploadURL == "" {
		uploadURL = defaultDriveUploadURL
	}
	values := url.Values{}
	values.Set("uploadType", "resumable")
	values.Set("supportsAllDrives", "true")
	values.Set("fields", "id,name,mimeType,size,webViewLink")
	endpoint := uploadURL + "?" + values.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("X-Upload-Content-Type", meta.MIMEType)
	req.Header.Set("X-Upload-Content-Length", strconv.FormatInt(meta.TotalSize, 10))

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("google drive create upload failed: status %d", resp.StatusCode)
	}
	location := resp.Header.Get("Location")
	if location == "" {
		return "", errors.New("google drive create upload response did not include Location")
	}
	return location, nil
}

func (c *Client) UploadChunk(ctx context.Context, uploadURL string, chunk []byte, start int64, total int64) (ChunkResult, error) {
	if strings.TrimSpace(uploadURL) == "" {
		return ChunkResult{}, errors.New("upload URL is required")
	}
	if total <= 0 {
		return ChunkResult{}, errors.New("total size must be positive")
	}
	if start < 0 || int64(len(chunk)) == 0 || start+int64(len(chunk)) > total {
		return ChunkResult{}, errors.New("invalid chunk range")
	}
	token, err := c.token(ctx)
	if err != nil {
		return ChunkResult{}, err
	}

	end := start + int64(len(chunk)) - 1
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(chunk))
	if err != nil {
		return ChunkResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Length", strconv.Itoa(len(chunk)))
	req.Header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return ChunkResult{}, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated:
		var file File
		if len(body) > 0 {
			if err := json.Unmarshal(body, &file); err != nil {
				return ChunkResult{}, err
			}
		}
		return ChunkResult{Complete: true, NextOffset: total, File: &file}, nil
	case http.StatusPermanentRedirect:
		next := end + 1
		if rangeHeader := resp.Header.Get("Range"); rangeHeader != "" {
			parsed, err := parseDriveRange(rangeHeader)
			if err != nil {
				return ChunkResult{}, err
			}
			next = parsed + 1
		}
		return ChunkResult{Complete: false, NextOffset: next}, nil
	default:
		return ChunkResult{}, fmt.Errorf("google drive chunk upload failed: status %d", resp.StatusCode)
	}
}

func (c *Client) token(ctx context.Context) (string, error) {
	if c.TokenSource == nil {
		return "", errors.New("google drive token source is not configured")
	}
	return c.TokenSource.Token(ctx)
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func validateMetadata(meta UploadMetadata) error {
	if strings.TrimSpace(meta.Name) == "" {
		return errors.New("file name is required")
	}
	if meta.TotalSize <= 0 {
		return errors.New("total size must be positive")
	}
	if _, _, err := mime.ParseMediaType(meta.MIMEType); err != nil || strings.TrimSpace(meta.MIMEType) == "" {
		return errors.New("valid MIME type is required")
	}
	return nil
}

func parseDriveRange(value string) (int64, error) {
	if !strings.HasPrefix(value, "bytes=0-") {
		return 0, fmt.Errorf("unsupported drive range: %s", value)
	}
	end, err := strconv.ParseInt(strings.TrimPrefix(value, "bytes=0-"), 10, 64)
	if err != nil || end < 0 {
		return 0, fmt.Errorf("invalid drive range: %s", value)
	}
	return end, nil
}
