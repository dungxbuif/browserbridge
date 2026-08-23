package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dungxbuif/browser-bridge/server/internal/drive"
	"github.com/dungxbuif/browser-bridge/server/internal/store"
)

func TestTabsRouteRejectsBadToken(t *testing.T) {
	server := New("test-token", slog.Default())
	req := httptest.NewRequest(http.MethodGet, "/v1/tabs", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestStatusRouteReportsReadiness(t *testing.T) {
	server := New("test-token", slog.Default(), WithDriveUploader(&fakeDriveUploader{}), WithDefaultDriveFolderID("folder-1"), WithMediaStore(fakeMediaStore{}))
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		OK                 bool `json:"ok"`
		ExtensionConnected bool `json:"extension_connected"`
		DriveConfigured    bool `json:"drive_configured"`
		DriveFolderSet     bool `json:"drive_folder_set"`
		MediaStoreSet      bool `json:"media_store_set"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.ExtensionConnected || !body.DriveConfigured || !body.DriveFolderSet || !body.MediaStoreSet {
		t.Fatalf("body = %+v", body)
	}
}

func TestStatusRouteRejectsBadToken(t *testing.T) {
	server := New("test-token", slog.Default())
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestCallWithoutExtension(t *testing.T) {
	server := New("test-token", slog.Default())
	_, err := server.call("tabs.list", nil, commandTimeout)
	if !errors.Is(err, errNoClient) {
		t.Fatalf("call error = %v, want %v", err, errNoClient)
	}
}

func TestOpenTabRejectsInvalidURL(t *testing.T) {
	server := New("test-token", slog.Default())
	req := httptest.NewRequest(http.MethodPost, "/v1/tabs", bytes.NewBufferString(`{"url":"javascript:alert(1)"}`))
	req.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestCloseTabRejectsInvalidTabID(t *testing.T) {
	server := New("test-token", slog.Default())
	req := httptest.NewRequest(http.MethodDelete, "/v1/tabs/not-a-number", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestRuntimeEvaluateRejectsInvalidWorld(t *testing.T) {
	server := New("test-token", slog.Default())
	req := httptest.NewRequest(http.MethodPost, "/v1/runtime/evaluate", bytes.NewBufferString(`{"expression":"1+1","world":"PAGE"}`))
	req.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestTokenMatches(t *testing.T) {
	server := New("test-token", slog.Default())
	if !server.tokenMatches("test-token") {
		t.Fatal("expected matching token")
	}
	if server.tokenMatches("wrong-token") || server.tokenMatches("") {
		t.Fatal("unexpected token match")
	}
}

func TestMediaUploadSessionFlow(t *testing.T) {
	uploader := &fakeDriveUploader{}
	server := New("test-token", slog.Default(), WithDriveUploader(uploader))
	handler := server.Handler()

	createBody := bytes.NewBufferString(`{"filename":"clip.mp4","mime_type":"video/mp4","total_size":6}`)
	createReq := httptest.NewRequest(http.MethodPost, "/v1/media/upload-sessions", createBody)
	createReq.Header.Set("Authorization", "Bearer test-token")
	createResp := httptest.NewRecorder()
	handler.ServeHTTP(createResp, createReq)
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createResp.Code, createResp.Body.String())
	}
	var created struct {
		ID         string `json:"id"`
		NextOffset int64  `json:"next_offset"`
		Status     string `json:"status"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.NextOffset != 0 || created.Status != "uploading" {
		t.Fatalf("created = %+v", created)
	}
	assertActiveUploads(t, handler, 1)

	firstReq := httptest.NewRequest(http.MethodPut, "/v1/media/upload-sessions/"+created.ID, bytes.NewBufferString("abc"))
	firstReq.Header.Set("Authorization", "Bearer test-token")
	firstReq.Header.Set("Content-Range", "bytes 0-2/6")
	firstResp := httptest.NewRecorder()
	handler.ServeHTTP(firstResp, firstReq)
	if firstResp.Code != http.StatusOK {
		t.Fatalf("first chunk status = %d, body = %s", firstResp.Code, firstResp.Body.String())
	}

	outOfOrderReq := httptest.NewRequest(http.MethodPut, "/v1/media/upload-sessions/"+created.ID, bytes.NewBufferString("z"))
	outOfOrderReq.Header.Set("Authorization", "Bearer test-token")
	outOfOrderReq.Header.Set("Content-Range", "bytes 4-4/6")
	outOfOrderResp := httptest.NewRecorder()
	handler.ServeHTTP(outOfOrderResp, outOfOrderReq)
	if outOfOrderResp.Code != http.StatusConflict {
		t.Fatalf("out-of-order status = %d", outOfOrderResp.Code)
	}

	finalReq := httptest.NewRequest(http.MethodPut, "/v1/media/upload-sessions/"+created.ID, bytes.NewBufferString("def"))
	finalReq.Header.Set("Authorization", "Bearer test-token")
	finalReq.Header.Set("Content-Range", "bytes 3-5/6")
	finalResp := httptest.NewRecorder()
	handler.ServeHTTP(finalResp, finalReq)
	if finalResp.Code != http.StatusOK {
		t.Fatalf("final chunk status = %d, body = %s", finalResp.Code, finalResp.Body.String())
	}
	var completed struct {
		NextOffset int64       `json:"next_offset"`
		Status     string      `json:"status"`
		File       *drive.File `json:"file"`
	}
	if err := json.NewDecoder(finalResp.Body).Decode(&completed); err != nil {
		t.Fatal(err)
	}
	if completed.NextOffset != 6 || completed.Status != "complete" || completed.File == nil || completed.File.ID != "drive-file-1" {
		t.Fatalf("completed = %+v", completed)
	}
	assertActiveUploads(t, handler, 0)
}

func assertActiveUploads(t *testing.T, handler http.Handler, want int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("status route status = %d, body = %s", response.Code, response.Body.String())
	}
	var body struct {
		ActiveUploads int `json:"active_uploads"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.ActiveUploads != want {
		t.Fatalf("active_uploads = %d, want %d", body.ActiveUploads, want)
	}
}

func TestMediaUploadSessionRejectsBadToken(t *testing.T) {
	server := New("test-token", slog.Default(), WithDriveUploader(&fakeDriveUploader{}))
	req := httptest.NewRequest(http.MethodPost, "/v1/media/upload-sessions", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer wrong")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
}

type fakeDriveUploader struct{}

func (f *fakeDriveUploader) CreateUpload(context.Context, drive.UploadMetadata) (string, error) {
	return "fake-upload-url", nil
}

func (f *fakeDriveUploader) UploadChunk(_ context.Context, _ string, chunk []byte, start int64, total int64) (drive.ChunkResult, error) {
	next := start + int64(len(chunk))
	if next == total {
		return drive.ChunkResult{Complete: true, NextOffset: total, File: &drive.File{ID: "drive-file-1", Name: "clip.mp4"}}, nil
	}
	return drive.ChunkResult{NextOffset: next}, nil
}

type fakeMediaStore struct{}

func (fakeMediaStore) SaveMediaAsset(context.Context, store.MediaAsset) error {
	return nil
}

func (fakeMediaStore) UpsertSocialUser(context.Context, store.SocialUser) error {
	return nil
}
