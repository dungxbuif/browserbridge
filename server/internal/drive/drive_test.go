package drive

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestClientCreateUploadAndChunks(t *testing.T) {
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/upload/drive/v3/files"):
			if got := r.Header.Get("Authorization"); got != "Bearer access-token" {
				t.Fatalf("authorization = %q", got)
			}
			if got := r.Header.Get("X-Upload-Content-Length"); got != "6" {
				t.Fatalf("upload content length = %q", got)
			}
			return response(http.StatusOK, "", http.Header{"Location": []string{"https://upload.example/session/123"}}), nil
		case r.Method == http.MethodPut && r.URL.String() == "https://upload.example/session/123":
			switch r.Header.Get("Content-Range") {
			case "bytes 0-2/6":
				return response(http.StatusPermanentRedirect, "", http.Header{"Range": []string{"bytes=0-2"}}), nil
			case "bytes 3-5/6":
				body, _ := json.Marshal(File{ID: "file-1", Name: "clip.mp4"})
				return response(http.StatusOK, string(body), nil), nil
			default:
				t.Fatalf("unexpected content range %q", r.Header.Get("Content-Range"))
			}
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		return nil, nil
	})

	client := &Client{
		HTTPClient:  &http.Client{Transport: transport},
		TokenSource: StaticTokenSource{AccessToken: "access-token"},
		UploadURL:   "https://drive.example/upload/drive/v3/files",
	}
	uploadURL, err := client.CreateUpload(context.Background(), UploadMetadata{Name: "clip.mp4", MIMEType: "video/mp4", TotalSize: 6})
	if err != nil {
		t.Fatal(err)
	}
	first, err := client.UploadChunk(context.Background(), uploadURL, []byte("abc"), 0, 6)
	if err != nil {
		t.Fatal(err)
	}
	if first.Complete || first.NextOffset != 3 {
		t.Fatalf("first = %+v", first)
	}
	final, err := client.UploadChunk(context.Background(), uploadURL, []byte("def"), 3, 6)
	if err != nil {
		t.Fatal(err)
	}
	if !final.Complete || final.NextOffset != 6 || final.File == nil || final.File.ID != "file-1" {
		t.Fatalf("final = %+v", final)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func response(status int, body string, header http.Header) *http.Response {
	if header == nil {
		header = http.Header{}
	}
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
	}
}
