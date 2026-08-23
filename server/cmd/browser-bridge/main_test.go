package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOAuthClientSecretInstalled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "client_secret.json")
	content := `{"installed":{"client_id":"client-id","client_secret":"client-secret"}}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	clientID, clientSecret, err := loadOAuthClientSecret(path)
	if err != nil {
		t.Fatal(err)
	}
	if clientID != "client-id" || clientSecret != "client-secret" {
		t.Fatalf("client = %q/%q", clientID, clientSecret)
	}
}

func TestLoadOAuthClientSecretWeb(t *testing.T) {
	path := filepath.Join(t.TempDir(), "client_secret.json")
	content := `{"web":{"client_id":"client-id","client_secret":"client-secret"}}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	clientID, clientSecret, err := loadOAuthClientSecret(path)
	if err != nil {
		t.Fatal(err)
	}
	if clientID != "client-id" || clientSecret != "client-secret" {
		t.Fatalf("client = %q/%q", clientID, clientSecret)
	}
}
