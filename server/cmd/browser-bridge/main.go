package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/dungxbuif/browser-bridge/server/internal/bridge"
	"github.com/dungxbuif/browser-bridge/server/internal/drive"
	"github.com/dungxbuif/browser-bridge/server/internal/store"
)

func main() {
	token := os.Getenv("BROWSER_BRIDGE_AUTH_TOKEN")
	if token == "" {
		slog.Error("BROWSER_BRIDGE_AUTH_TOKEN is required")
		os.Exit(1)
	}
	address := os.Getenv("BROWSER_BRIDGE_LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8788"
	}

	options := []bridge.Option{}
	if uploader := driveUploaderFromEnv(); uploader != nil {
		options = append(options, bridge.WithDriveUploader(uploader))
		slog.Info("google drive uploader configured")
	} else {
		slog.Warn("google drive uploader is not configured; media upload endpoints will return 503")
	}
	if folderID := os.Getenv("GOOGLE_DRIVE_FOLDER_ID"); folderID != "" {
		options = append(options, bridge.WithDefaultDriveFolderID(folderID))
		slog.Info("google drive default folder configured")
	}
	if mediaStore := mediaStoreFromEnv(); mediaStore != nil {
		defer mediaStore.Close()
		options = append(options, bridge.WithMediaStore(mediaStore))
		slog.Info("postgres media store configured")
	}

	server := bridge.New(token, slog.Default(), options...)
	slog.Info("browser bridge listening", "address", address)
	if err := http.ListenAndServe(address, server.Handler()); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func mediaStoreFromEnv() *store.Postgres {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	mediaStore, err := store.OpenPostgres(ctx, databaseURL)
	if err != nil {
		slog.Error("failed to configure postgres media store", "error", err)
		os.Exit(1)
	}
	return mediaStore
}

func driveUploaderFromEnv() *drive.Client {
	if token := os.Getenv("GOOGLE_DRIVE_ACCESS_TOKEN"); token != "" {
		return &drive.Client{TokenSource: drive.StaticTokenSource{AccessToken: token}}
	}
	clientID := os.Getenv("GOOGLE_DRIVE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_DRIVE_CLIENT_SECRET")
	refreshToken := os.Getenv("GOOGLE_DRIVE_REFRESH_TOKEN")
	if secretFile := os.Getenv("GOOGLE_DRIVE_CLIENT_SECRET_FILE"); secretFile != "" {
		fileClientID, fileClientSecret, err := loadOAuthClientSecret(secretFile)
		if err != nil {
			slog.Warn("failed to load google drive client secret file", "error", err)
		} else {
			clientID = fileClientID
			clientSecret = fileClientSecret
		}
	}
	if clientID == "" || clientSecret == "" || refreshToken == "" {
		return nil
	}
	return &drive.Client{TokenSource: &drive.RefreshTokenSource{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RefreshToken: refreshToken,
	}}
}

func loadOAuthClientSecret(filename string) (string, string, error) {
	data, err := os.ReadFile(filename)
	if err != nil {
		return "", "", err
	}
	var parsed struct {
		Installed *oauthClient `json:"installed"`
		Web       *oauthClient `json:"web"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", "", err
	}
	client := parsed.Installed
	if client == nil {
		client = parsed.Web
	}
	if client == nil || client.ClientID == "" || client.ClientSecret == "" {
		return "", "", os.ErrInvalid
	}
	return client.ClientID, client.ClientSecret, nil
}

type oauthClient struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}
