package bridge

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dungxbuif/browser-bridge/server/internal/drive"
	"github.com/dungxbuif/browser-bridge/server/internal/protocol"
	"github.com/dungxbuif/browser-bridge/server/internal/store"
	"github.com/dungxbuif/browser-bridge/server/internal/ws"
)

const commandTimeout = 10 * time.Second
const evaluateTimeout = 60 * time.Second
const mediaCommandTimeout = 2 * time.Hour
const maxMediaSize = 10 << 30
const maxChunkSize = 8 << 20
const maxEvaluateExpressionSize = 64 << 10

type Server struct {
	token       string
	logger      *slog.Logger
	drive       drive.Uploader
	driveFolder string
	mediaStore  store.MediaStore
	mu          sync.Mutex
	active      *client
	uploads     map[string]*uploadSession
	uploadsLock sync.Mutex
}

type client struct {
	conn    *ws.Conn
	writeMu sync.Mutex

	mu      sync.Mutex
	pending map[string]chan protocol.Message
	closed  chan struct{}
	once    sync.Once
}

type Option func(*Server)

func WithDriveUploader(uploader drive.Uploader) Option {
	return func(s *Server) {
		s.drive = uploader
	}
}

func WithDefaultDriveFolderID(folderID string) Option {
	return func(s *Server) {
		s.driveFolder = strings.TrimSpace(folderID)
	}
}

func WithMediaStore(mediaStore store.MediaStore) Option {
	return func(s *Server) {
		s.mediaStore = mediaStore
	}
}

func New(token string, logger *slog.Logger, options ...Option) *Server {
	s := &Server{
		token:   token,
		logger:  logger,
		uploads: make(map[string]*uploadSession),
	}
	for _, option := range options {
		option(s)
	}
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /v1/status", s.handleStatus)
	mux.HandleFunc("GET /v1/tabs", s.handleTabs)
	mux.HandleFunc("POST /v1/tabs", s.handleOpenTab)
	mux.HandleFunc("DELETE /v1/tabs/{id}", s.handleCloseTab)
	mux.HandleFunc("POST /v1/runtime/evaluate", s.handleRuntimeEvaluate)
	mux.HandleFunc("POST /v1/media/transfers", s.handleMediaTransfer)
	mux.HandleFunc("POST /v1/media/upload-sessions", s.handleCreateUploadSession)
	mux.HandleFunc("GET /v1/media/upload-sessions/{id}", s.handleGetUploadSession)
	mux.HandleFunc("PUT /v1/media/upload-sessions/{id}", s.handleUploadSessionChunk)
	mux.HandleFunc("GET /v1/extension", s.handleExtension)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s.mu.Lock()
	extensionConnected := s.active != nil
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                  true,
		"extension_connected": extensionConnected,
		"drive_configured":    s.drive != nil,
		"drive_folder_set":    s.driveFolder != "",
		"media_store_set":     s.mediaStore != nil,
		"active_uploads":      s.uploadCount(),
	})
}

func (s *Server) handleTabs(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	result, err := s.call("tabs.list", json.RawMessage(`{}`), commandTimeout)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errNoClient) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

type openTabRequest struct {
	URL    string `json:"url"`
	Active *bool  `json:"active,omitempty"`
}

func (s *Server) handleOpenTab(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var request openTabRequest
	if err := decodeJSON(r, &request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateHTTPURL(request.URL); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	params, _ := json.Marshal(map[string]any{
		"url":    request.URL,
		"active": request.Active == nil || *request.Active,
	})
	result, err := s.call("tabs.open", params, commandTimeout)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errNoClient) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

func (s *Server) handleCloseTab(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tabID, err := strconv.Atoi(strings.TrimSpace(r.PathValue("id")))
	if err != nil || tabID <= 0 {
		http.Error(w, "tab id must be a positive integer", http.StatusBadRequest)
		return
	}
	params, _ := json.Marshal(map[string]any{"tab_id": tabID})
	result, err := s.call("tabs.close", params, commandTimeout)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errNoClient) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

type mediaTransferRequest struct {
	MediaURL       string          `json:"media_url"`
	Filename       string          `json:"filename"`
	MIMEType       string          `json:"mime_type"`
	DriveFolderID  string          `json:"drive_folder_id,omitempty"`
	TabID          int             `json:"tab_id,omitempty"`
	Platform       string          `json:"platform,omitempty"`
	SourceUserID   string          `json:"source_user_id,omitempty"`
	SourceUsername string          `json:"source_username,omitempty"`
	MediaID        string          `json:"media_id,omitempty"`
	PostID         string          `json:"post_id,omitempty"`
	MediaType      string          `json:"media_type,omitempty"`
	PreviewURL     string          `json:"preview_url,omitempty"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
}

type runtimeEvaluateRequest struct {
	TabID      int    `json:"tab_id,omitempty"`
	Expression string `json:"expression"`
	World      string `json:"world,omitempty"`
}

func (s *Server) handleRuntimeEvaluate(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var request runtimeEvaluateRequest
	if err := decodeJSON(r, &request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(request.Expression) == "" {
		http.Error(w, "expression is required", http.StatusBadRequest)
		return
	}
	if len(request.Expression) > maxEvaluateExpressionSize {
		http.Error(w, "expression is too large", http.StatusRequestEntityTooLarge)
		return
	}
	if request.World != "" && request.World != "MAIN" && request.World != "ISOLATED" {
		http.Error(w, "world must be MAIN or ISOLATED", http.StatusBadRequest)
		return
	}
	params, _ := json.Marshal(request)
	result, err := s.call("runtime.evaluate", params, evaluateTimeout)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errNoClient) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

func (s *Server) handleMediaTransfer(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var request mediaTransferRequest
	if err := decodeJSON(r, &request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(request.MediaURL) == "" || strings.TrimSpace(request.Filename) == "" {
		http.Error(w, "media_url and filename are required", http.StatusBadRequest)
		return
	}
	if err := validateHTTPURL(request.MediaURL); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	params, _ := json.Marshal(request)
	result, err := s.call("media.uploadToDrive", params, mediaCommandTimeout)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errNoClient) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

type createUploadSessionRequest struct {
	Filename       string          `json:"filename"`
	MIMEType       string          `json:"mime_type"`
	DriveFolderID  string          `json:"drive_folder_id,omitempty"`
	TotalSize      int64           `json:"total_size"`
	MediaURL       string          `json:"media_url,omitempty"`
	Platform       string          `json:"platform,omitempty"`
	SourceUserID   string          `json:"source_user_id,omitempty"`
	SourceUsername string          `json:"source_username,omitempty"`
	MediaID        string          `json:"media_id,omitempty"`
	PostID         string          `json:"post_id,omitempty"`
	MediaType      string          `json:"media_type,omitempty"`
	PreviewURL     string          `json:"preview_url,omitempty"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
}

type uploadSession struct {
	ID             string
	UploadURL      string
	Filename       string
	MIMEType       string
	TotalSize      int64
	NextOffset     int64
	Status         string
	FinalFile      *drive.File
	SourceURL      string
	Platform       string
	SourceUserID   string
	SourceUsername string
	MediaID        string
	PostID         string
	MediaType      string
	PreviewURL     string
	Metadata       json.RawMessage
	CreatedAt      time.Time
	UpdatedAt      time.Time
	mu             sync.Mutex
}

func (s *Server) handleCreateUploadSession(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if s.drive == nil {
		http.Error(w, "google drive uploader is not configured", http.StatusServiceUnavailable)
		return
	}
	var request createUploadSessionRequest
	if err := decodeJSON(r, &request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	filename, err := cleanFilename(request.Filename)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if request.TotalSize <= 0 || request.TotalSize > maxMediaSize {
		http.Error(w, "total_size is out of range", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(request.MIMEType) == "" {
		http.Error(w, "mime_type is required", http.StatusBadRequest)
		return
	}
	folderID := strings.TrimSpace(request.DriveFolderID)
	if folderID == "" {
		folderID = s.driveFolder
	}

	uploadURL, err := s.drive.CreateUpload(r.Context(), drive.UploadMetadata{
		Name:      filename,
		MIMEType:  request.MIMEType,
		FolderID:  folderID,
		TotalSize: request.TotalSize,
	})
	if err != nil {
		s.logger.Warn("drive upload session create failed", "error", err)
		http.Error(w, "drive upload session create failed", http.StatusBadGateway)
		return
	}

	now := time.Now().UTC()
	session := &uploadSession{
		ID:             newID(),
		UploadURL:      uploadURL,
		Filename:       filename,
		MIMEType:       request.MIMEType,
		TotalSize:      request.TotalSize,
		Status:         "uploading",
		CreatedAt:      now,
		UpdatedAt:      now,
		NextOffset:     0,
		SourceURL:      request.MediaURL,
		Platform:       strings.TrimSpace(request.Platform),
		SourceUserID:   strings.TrimSpace(request.SourceUserID),
		SourceUsername: strings.TrimSpace(request.SourceUsername),
		MediaID:        strings.TrimSpace(request.MediaID),
		PostID:         strings.TrimSpace(request.PostID),
		MediaType:      strings.TrimSpace(request.MediaType),
		PreviewURL:     strings.TrimSpace(request.PreviewURL),
		Metadata:       normalizeMetadata(request.Metadata),
	}
	s.uploadsLock.Lock()
	s.uploads[session.ID] = session
	s.uploadsLock.Unlock()
	writeJSON(w, http.StatusCreated, sessionResponse(session))
}

func (s *Server) handleGetUploadSession(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	session := s.findUploadSession(r.PathValue("id"))
	if session == nil {
		http.Error(w, "upload session not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, sessionResponse(session))
}

func (s *Server) handleUploadSessionChunk(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedHTTP(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if s.drive == nil {
		http.Error(w, "google drive uploader is not configured", http.StatusServiceUnavailable)
		return
	}
	session := s.findUploadSession(r.PathValue("id"))
	if session == nil {
		http.Error(w, "upload session not found", http.StatusNotFound)
		return
	}
	start, end, total, err := parseContentRange(r.Header.Get("Content-Range"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if total != session.TotalSize || end < start {
		http.Error(w, "content range does not match upload session", http.StatusBadRequest)
		return
	}
	chunkSize := end - start + 1
	if chunkSize <= 0 || chunkSize > maxChunkSize {
		http.Error(w, "chunk size is out of range", http.StatusRequestEntityTooLarge)
		return
	}
	if r.ContentLength >= 0 && r.ContentLength != chunkSize {
		http.Error(w, "content length does not match content range", http.StatusBadRequest)
		return
	}
	body := http.MaxBytesReader(w, r.Body, chunkSize)
	chunk, err := io.ReadAll(body)
	if err != nil {
		http.Error(w, "failed to read chunk", http.StatusBadRequest)
		return
	}
	if int64(len(chunk)) != chunkSize {
		http.Error(w, "request body is shorter than content range", http.StatusBadRequest)
		return
	}

	session.mu.Lock()
	defer session.mu.Unlock()
	if session.Status == "complete" {
		http.Error(w, "upload session is complete", http.StatusConflict)
		return
	}
	if start != session.NextOffset {
		http.Error(w, "chunk start does not match next offset", http.StatusConflict)
		return
	}
	result, err := s.drive.UploadChunk(r.Context(), session.UploadURL, chunk, start, total)
	if err != nil {
		s.logger.Warn("drive chunk upload failed", "session_id", session.ID, "error", err)
		http.Error(w, "drive chunk upload failed", http.StatusBadGateway)
		return
	}
	session.NextOffset = result.NextOffset
	session.UpdatedAt = time.Now().UTC()
	if result.Complete {
		session.Status = "complete"
		session.FinalFile = result.File
		if err := s.saveCompletedMediaAssetLocked(r.Context(), session); err != nil {
			s.logger.Warn("media asset metadata save failed", "session_id", session.ID, "error", err)
		}
	}
	writeJSON(w, http.StatusOK, sessionResponseLocked(session))
}

func (s *Server) handleExtension(w http.ResponseWriter, r *http.Request) {
	conn, err := ws.Upgrade(w, r)
	if err != nil {
		return
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(commandTimeout))
	var hello protocol.Message
	if err := conn.ReadJSON(&hello); err != nil || hello.Type != "hello" || hello.Validate() != nil || !s.tokenMatches(hello.Token) {
		return
	}
	conn.SetReadDeadline(time.Time{})

	c := &client{conn: conn, pending: make(map[string]chan protocol.Message), closed: make(chan struct{})}
	s.replaceActive(c)
	defer s.removeActive(c)

	if err := c.write(protocol.Message{Version: protocol.Version, Type: "welcome", ID: newID()}); err != nil {
		return
	}
	s.logger.Info("extension connected", "capabilities", len(hello.Capabilities))
	c.readLoop(s.logger)
}

func (s *Server) replaceActive(next *client) {
	s.mu.Lock()
	previous := s.active
	s.active = next
	s.mu.Unlock()
	if previous != nil {
		previous.close()
	}
}

func (s *Server) removeActive(c *client) {
	c.close()
	s.mu.Lock()
	if s.active == c {
		s.active = nil
	}
	s.mu.Unlock()
	s.logger.Info("extension disconnected")
}

var errNoClient = errors.New("extension is not connected")

func (s *Server) call(method string, params json.RawMessage, timeout time.Duration) (json.RawMessage, error) {
	s.mu.Lock()
	c := s.active
	s.mu.Unlock()
	if c == nil {
		return nil, errNoClient
	}

	id := newID()
	response := make(chan protocol.Message, 1)
	if !c.addPending(id, response) {
		return nil, errNoClient
	}
	defer c.removePending(id)

	deadline := time.Now().Add(timeout).UTC().Format(time.RFC3339Nano)
	if err := c.write(protocol.Message{Version: protocol.Version, Type: "command", ID: id, Method: method, DeadlineAt: deadline, Params: params}); err != nil {
		return nil, errNoClient
	}

	select {
	case reply := <-response:
		if reply.Type == "error" && reply.Error != nil {
			return nil, errors.New(reply.Error.Code + ": " + reply.Error.Message)
		}
		return reply.Result, nil
	case <-c.closed:
		return nil, errNoClient
	case <-time.After(timeout):
		_ = c.write(protocol.Message{Version: protocol.Version, Type: "cancel", ID: id})
		return nil, errors.New("command deadline exceeded")
	}
}

func (s *Server) authorizedHTTP(r *http.Request) bool {
	return s.tokenMatches(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
}

func (s *Server) findUploadSession(id string) *uploadSession {
	s.uploadsLock.Lock()
	defer s.uploadsLock.Unlock()
	return s.uploads[id]
}

func (s *Server) uploadCount() int {
	s.uploadsLock.Lock()
	defer s.uploadsLock.Unlock()
	count := 0
	for _, session := range s.uploads {
		session.mu.Lock()
		active := session.Status != "complete"
		session.mu.Unlock()
		if active {
			count++
		}
	}
	return count
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func sessionResponse(session *uploadSession) map[string]any {
	session.mu.Lock()
	defer session.mu.Unlock()
	return sessionResponseLocked(session)
}

func sessionResponseLocked(session *uploadSession) map[string]any {
	response := map[string]any{
		"id":          session.ID,
		"filename":    session.Filename,
		"mime_type":   session.MIMEType,
		"total_size":  session.TotalSize,
		"next_offset": session.NextOffset,
		"status":      session.Status,
		"created_at":  session.CreatedAt.Format(time.RFC3339Nano),
		"updated_at":  session.UpdatedAt.Format(time.RFC3339Nano),
	}
	if session.FinalFile != nil {
		response["file"] = session.FinalFile
	}
	return response
}

func (s *Server) saveCompletedMediaAssetLocked(ctx context.Context, session *uploadSession) error {
	if s.mediaStore == nil || session.FinalFile == nil {
		return nil
	}
	if session.Platform == "" || session.SourceUserID == "" || session.MediaID == "" {
		return nil
	}
	sizeBytes := session.TotalSize
	if session.FinalFile.Size != "" {
		if parsed, err := strconv.ParseInt(session.FinalFile.Size, 10, 64); err == nil {
			sizeBytes = parsed
		}
	}
	return s.mediaStore.SaveMediaAsset(ctx, store.MediaAsset{
		Platform:       session.Platform,
		SourceUserID:   session.SourceUserID,
		SourceUsername: session.SourceUsername,
		MediaID:        session.MediaID,
		PostID:         session.PostID,
		SourceURL:      session.SourceURL,
		DriveFileID:    session.FinalFile.ID,
		DriveLink:      session.FinalFile.WebViewLink,
		Filename:       session.Filename,
		MIMEType:       session.MIMEType,
		SizeBytes:      sizeBytes,
		MediaType:      session.MediaType,
		PreviewURL:     session.PreviewURL,
		Metadata:       session.Metadata,
		UploadedAt:     time.Now().UTC(),
	})
}

func normalizeMetadata(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || !json.Valid(raw) {
		return json.RawMessage(`{}`)
	}
	return raw
}

func cleanFilename(filename string) (string, error) {
	name := strings.TrimSpace(filename)
	if name == "" {
		return "", errors.New("filename is required")
	}
	if name != path.Base(name) || strings.Contains(name, `\`) {
		return "", errors.New("filename must not contain path separators")
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return "", errors.New("filename contains control characters")
		}
	}
	return name, nil
}

func validateHTTPURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return errors.New("media_url must be an absolute URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("media_url must use http or https")
	}
	return nil
}

func parseContentRange(value string) (int64, int64, int64, error) {
	if !strings.HasPrefix(value, "bytes ") {
		return 0, 0, 0, errors.New("Content-Range must use bytes unit")
	}
	parts := strings.Split(strings.TrimPrefix(value, "bytes "), "/")
	if len(parts) != 2 {
		return 0, 0, 0, errors.New("Content-Range must be bytes start-end/total")
	}
	rangeParts := strings.Split(parts[0], "-")
	if len(rangeParts) != 2 {
		return 0, 0, 0, errors.New("Content-Range must be bytes start-end/total")
	}
	start, err := strconv.ParseInt(rangeParts[0], 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("invalid Content-Range start: %w", err)
	}
	end, err := strconv.ParseInt(rangeParts[1], 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("invalid Content-Range end: %w", err)
	}
	total, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("invalid Content-Range total: %w", err)
	}
	if start < 0 || end < start || total <= 0 || end >= total {
		return 0, 0, 0, errors.New("Content-Range values are invalid")
	}
	return start, end, total, nil
}

func (s *Server) tokenMatches(candidate string) bool {
	if candidate == "" || s.token == "" || len(candidate) != len(s.token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(s.token)) == 1
}

func (c *client) write(message protocol.Message) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteJSON(message)
}

func (c *client) addPending(id string, response chan protocol.Message) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	select {
	case <-c.closed:
		return false
	default:
		c.pending[id] = response
		return true
	}
}

func (c *client) removePending(id string) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
}

func (c *client) readLoop(logger *slog.Logger) {
	for {
		var message protocol.Message
		if err := c.conn.ReadJSON(&message); err != nil {
			return
		}
		if err := message.Validate(); err != nil {
			logger.Warn("invalid extension message", "error", err)
			continue
		}
		switch message.Type {
		case "ping":
			_ = c.write(protocol.Message{Version: protocol.Version, Type: "pong"})
		case "result", "error":
			c.mu.Lock()
			response := c.pending[message.ID]
			c.mu.Unlock()
			if response != nil {
				select {
				case response <- message:
				default:
				}
			}
		}
	}
}

func (c *client) close() {
	c.once.Do(func() {
		close(c.closed)
		_ = c.conn.Close()
	})
}

func newID() string {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(bytes)
}
