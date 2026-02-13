package telemetry

import (
	"sync"
	"testing"
	"time"
)

func TestCaptureSendsMergedPayload(t *testing.T) {
	var (
		mu       sync.Mutex
		calls    int
		observed capturePayload
	)

	originalSendFunc := sendFunc
	sendFunc = func(payload capturePayload) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		observed = payload
	}
	t.Cleanup(func() {
		sendFunc = originalSendFunc
	})

	SetContext("1.2.3", "prod")
	Capture("cloudrouter_sandbox_created", map[string]interface{}{
		"provider": "e2b",
		"has_gpu":  false,
	})

	if drained := Drain(2 * time.Second); !drained {
		t.Fatal("telemetry drain timed out")
	}

	mu.Lock()
	defer mu.Unlock()

	if calls != 1 {
		t.Fatalf("expected 1 send call, got %d", calls)
	}
	if observed.Event != "cloudrouter_sandbox_created" {
		t.Fatalf("unexpected event: %q", observed.Event)
	}
	if observed.Properties["provider"] != "e2b" {
		t.Fatalf("unexpected provider: %v", observed.Properties["provider"])
	}
	if observed.Properties["cli_version"] != "1.2.3" {
		t.Fatalf("unexpected cli_version: %v", observed.Properties["cli_version"])
	}
	if observed.Properties["build_mode"] != "prod" {
		t.Fatalf("unexpected build_mode: %v", observed.Properties["build_mode"])
	}
	if observed.Properties["source"] != "cloudrouter_cli" {
		t.Fatalf("unexpected source: %v", observed.Properties["source"])
	}
}

func TestCaptureWithEmptyEventNoops(t *testing.T) {
	var calls int

	originalSendFunc := sendFunc
	sendFunc = func(payload capturePayload) {
		calls++
	}
	t.Cleanup(func() {
		sendFunc = originalSendFunc
	})

	Capture("", map[string]interface{}{
		"auth_flow": "stack_cli",
	})

	if drained := Drain(200 * time.Millisecond); !drained {
		t.Fatal("telemetry drain timed out")
	}

	if calls != 0 {
		t.Fatalf("expected no send calls, got %d", calls)
	}
}
