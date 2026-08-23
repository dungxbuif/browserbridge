package ws

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"testing"
)

func TestConnReadsMaskedJSONAndWritesJSON(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()
	conn := &Conn{conn: serverConn, rw: bufio.NewReadWriter(bufio.NewReader(serverConn), bufio.NewWriter(serverConn))}

	go func() {
		writeMaskedText(t, clientConn, []byte(`{"message":"hello"}`))
	}()
	var received map[string]string
	if err := conn.ReadJSON(&received); err != nil {
		t.Fatal(err)
	}
	if received["message"] != "hello" {
		t.Fatalf("received = %#v", received)
	}

	go func() {
		if err := conn.WriteJSON(map[string]string{"message": "world"}); err != nil {
			t.Error(err)
		}
	}()
	payload := readServerText(t, clientConn)
	var written map[string]string
	if err := json.Unmarshal(payload, &written); err != nil {
		t.Fatal(err)
	}
	if written["message"] != "world" {
		t.Fatalf("written = %#v", written)
	}
}

func TestWebsocketAccept(t *testing.T) {
	if got, want := websocketAccept("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="; got != want {
		t.Fatalf("accept = %q, want %q", got, want)
	}
}

func writeMaskedText(t *testing.T, writer io.Writer, payload []byte) {
	t.Helper()
	mask := [4]byte{1, 2, 3, 4}
	frame := []byte{0x81, 0x80 | byte(len(payload)), mask[0], mask[1], mask[2], mask[3]}
	for i, value := range payload {
		frame = append(frame, value^mask[i%4])
	}
	if _, err := writer.Write(frame); err != nil {
		t.Error(err)
	}
}

func readServerText(t *testing.T, reader io.Reader) []byte {
	t.Helper()
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		t.Fatal(err)
	}
	if header[0] != 0x81 || header[1]&0x80 != 0 {
		t.Fatalf("unexpected server frame header: %x", header)
	}
	payload := make([]byte, int(header[1]&0x7F))
	if _, err := io.ReadFull(reader, payload); err != nil {
		t.Fatal(err)
	}
	return payload
}
