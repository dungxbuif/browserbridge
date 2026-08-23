package protocol

import (
	"encoding/json"
	"fmt"
	"strings"
)

const Version = 1

type Error struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type Message struct {
	Version      int             `json:"v"`
	Type         string          `json:"type"`
	ID           string          `json:"id,omitempty"`
	Method       string          `json:"method,omitempty"`
	Token        string          `json:"token,omitempty"`
	DeadlineAt   string          `json:"deadline_at,omitempty"`
	Params       json.RawMessage `json:"params,omitempty"`
	Result       json.RawMessage `json:"result,omitempty"`
	Error        *Error          `json:"error,omitempty"`
	Capabilities []string        `json:"capabilities,omitempty"`
	Enabled      *bool           `json:"enabled,omitempty"`
}

func (m Message) Validate() error {
	if m.Version != Version {
		return fmt.Errorf("unsupported protocol version: %d", m.Version)
	}
	if strings.TrimSpace(m.Type) == "" {
		return fmt.Errorf("message type is required")
	}
	switch m.Type {
	case "hello":
		if strings.TrimSpace(m.Token) == "" {
			return fmt.Errorf("hello token is required")
		}
	case "command":
		if strings.TrimSpace(m.ID) == "" || strings.TrimSpace(m.Method) == "" {
			return fmt.Errorf("command id and method are required")
		}
	case "result", "error", "cancel":
		if strings.TrimSpace(m.ID) == "" {
			return fmt.Errorf("%s id is required", m.Type)
		}
	}
	return nil
}

func NewError(id, code, message string, retryable bool) Message {
	return Message{Version: Version, Type: "error", ID: id, Error: &Error{Code: code, Message: message, Retryable: retryable}}
}
