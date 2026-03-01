package telemetry

import (
	"sync"
	"time"

	"github.com/manaflow-ai/cloudrouter/internal/api"
)

var (
	cliVersion = "dev"
	buildMode  = "dev"

	pendingEvents sync.WaitGroup
	sendFunc      = sendToServer
)

type capturePayload struct {
	Event      string
	Properties map[string]interface{}
}

// SetContext sets basic CLI metadata attached to each telemetry event.
func SetContext(version, mode string) {
	if version != "" {
		cliVersion = version
	}
	if mode != "" {
		buildMode = mode
	}
}

// Capture sends a telemetry event asynchronously to the backend relay.
func Capture(event string, properties map[string]interface{}) {
	if event == "" {
		return
	}

	mergedProps := make(map[string]interface{}, len(properties)+4)
	mergedProps["$lib"] = "cloudrouter-cli"
	mergedProps["cli_version"] = cliVersion
	mergedProps["build_mode"] = buildMode
	mergedProps["source"] = "cloudrouter_cli"
	for key, value := range properties {
		mergedProps[key] = value
	}

	payload := capturePayload{
		Event:      event,
		Properties: mergedProps,
	}

	pendingEvents.Add(1)
	go func() {
		defer pendingEvents.Done()
		sendFunc(payload)
	}()
}

// Drain waits for pending telemetry sends to complete, up to timeout.
func Drain(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		pendingEvents.Wait()
		close(done)
	}()

	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}

func sendToServer(payload capturePayload) {
	client := api.NewClient()
	_ = client.CaptureTelemetry(payload.Event, payload.Properties)
}
