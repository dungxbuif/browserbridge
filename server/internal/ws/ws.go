// Package ws provides the minimal RFC 6455 server transport required by the
// personal Browser Bridge. It deliberately supports only single-frame UTF-8
// JSON messages, close, ping and pong.
package ws

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const maxPayload = 1 << 20

type Conn struct {
	conn net.Conn
	rw   *bufio.ReadWriter
	mu   sync.Mutex
}

func Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || !headerContains(r.Header, "Connection", "Upgrade") || r.Header.Get("Sec-WebSocket-Version") != "13" {
		return nil, errors.New("invalid websocket upgrade")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing websocket key")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("response writer does not support hijacking")
	}
	connection, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	accept := websocketAccept(key)
	if _, err := rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"); err != nil {
		_ = connection.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		_ = connection.Close()
		return nil, err
	}
	return &Conn{conn: connection, rw: rw}, nil
}

func (c *Conn) ReadJSON(value any) error {
	for {
		opcode, payload, err := c.readFrame()
		if err != nil {
			return err
		}
		switch opcode {
		case 0x1:
			return json.Unmarshal(payload, value)
		case 0x8:
			return io.EOF
		case 0x9:
			if err := c.writeFrame(0xA, payload); err != nil {
				return err
			}
		}
	}
}

func (c *Conn) WriteJSON(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.writeFrame(0x1, payload)
}

func (c *Conn) SetReadDeadline(deadline time.Time) error { return c.conn.SetReadDeadline(deadline) }
func (c *Conn) Close() error                             { return c.conn.Close() }

func (c *Conn) readFrame() (byte, []byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(c.rw, header); err != nil {
		return 0, nil, err
	}
	if header[0]&0x80 == 0 {
		return 0, nil, errors.New("fragmented frames are unsupported")
	}
	opcode := header[0] & 0x0F
	masked := header[1]&0x80 != 0
	if !masked {
		return 0, nil, errors.New("client websocket frame must be masked")
	}
	length, err := readLength(c.rw, header[1]&0x7F)
	if err != nil {
		return 0, nil, err
	}
	if length > maxPayload {
		return 0, nil, fmt.Errorf("websocket payload exceeds %d bytes", maxPayload)
	}
	mask := make([]byte, 4)
	if _, err := io.ReadFull(c.rw, mask); err != nil {
		return 0, nil, err
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(c.rw, payload); err != nil {
		return 0, nil, err
	}
	for i := range payload {
		payload[i] ^= mask[i%4]
	}
	return opcode, payload, nil
}

func (c *Conn) writeFrame(opcode byte, payload []byte) error {
	if len(payload) > maxPayload {
		return fmt.Errorf("websocket payload exceeds %d bytes", maxPayload)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.rw.WriteByte(0x80 | opcode); err != nil {
		return err
	}
	switch {
	case len(payload) < 126:
		if err := c.rw.WriteByte(byte(len(payload))); err != nil {
			return err
		}
	case len(payload) <= 0xFFFF:
		if err := c.rw.WriteByte(126); err != nil {
			return err
		}
		var encoded [2]byte
		binary.BigEndian.PutUint16(encoded[:], uint16(len(payload)))
		if _, err := c.rw.Write(encoded[:]); err != nil {
			return err
		}
	default:
		if err := c.rw.WriteByte(127); err != nil {
			return err
		}
		var encoded [8]byte
		binary.BigEndian.PutUint64(encoded[:], uint64(len(payload)))
		if _, err := c.rw.Write(encoded[:]); err != nil {
			return err
		}
	}
	if _, err := c.rw.Write(payload); err != nil {
		return err
	}
	return c.rw.Flush()
}

func readLength(reader io.Reader, indicator byte) (int, error) {
	switch indicator {
	case 126:
		var encoded [2]byte
		if _, err := io.ReadFull(reader, encoded[:]); err != nil {
			return 0, err
		}
		return int(binary.BigEndian.Uint16(encoded[:])), nil
	case 127:
		var encoded [8]byte
		if _, err := io.ReadFull(reader, encoded[:]); err != nil {
			return 0, err
		}
		length := binary.BigEndian.Uint64(encoded[:])
		if length > maxPayload {
			return 0, fmt.Errorf("websocket payload exceeds %d bytes", maxPayload)
		}
		return int(length), nil
	default:
		return int(indicator), nil
	}
}

func headerContains(header http.Header, key, value string) bool {
	for _, item := range strings.Split(header.Get(key), ",") {
		if strings.EqualFold(strings.TrimSpace(item), value) {
			return true
		}
	}
	return false
}

func websocketAccept(key string) string {
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(sum[:])
}
