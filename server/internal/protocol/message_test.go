package protocol

import "testing"

func TestMessageValidate(t *testing.T) {
	tests := []struct {
		name string
		msg  Message
		ok   bool
	}{
		{"hello", Message{Version: Version, Type: "hello", Token: "secret"}, true},
		{"missing token", Message{Version: Version, Type: "hello"}, false},
		{"command", Message{Version: Version, Type: "command", ID: "1", Method: "tabs.list"}, true},
		{"missing command method", Message{Version: Version, Type: "command", ID: "1"}, false},
		{"wrong version", Message{Version: 2, Type: "hello", Token: "secret"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.msg.Validate()
			if (err == nil) != tt.ok {
				t.Fatalf("Validate() error = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}
