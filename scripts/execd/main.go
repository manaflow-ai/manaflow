package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

type execRequest struct {
	Command   string `json:"command"`
	TimeoutMs *int   `json:"timeout_ms"`
}

type execEvent struct {
	Type    string `json:"type"`
	Data    string `json:"data,omitempty"`
	Code    *int   `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

func writeJSONLine(w io.Writer, flusher http.Flusher, event execEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		log.Printf("failed to serialize event: %v", err)
		return err
	}
	if _, err = w.Write(append(payload, '\n')); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func readPipe(ctx context.Context, reader io.Reader, eventType string, wg *sync.WaitGroup, w io.Writer, flusher http.Flusher) {
	defer wg.Done()
	scanner := bufio.NewScanner(reader)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			continue
		}
		if err := writeJSONLine(w, flusher, execEvent{Type: eventType, Data: line}); err != nil {
			return
		}
	}
	if err := scanner.Err(); err != nil {
		_ = writeJSONLine(w, flusher, execEvent{
			Type:    "error",
			Message: fmt.Sprintf("%s read failed: %v", eventType, err),
		})
	}
}

func execHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	contentType := r.Header.Get("Content-Type")
	if !strings.Contains(strings.ToLower(contentType), "application/json") {
		http.Error(w, "Unsupported Content-Type", http.StatusUnsupportedMediaType)
		return
	}

	var payload execRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := decoder.Decode(&payload); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON body: %v", err), http.StatusBadRequest)
		return
	}

	command := strings.TrimSpace(payload.Command)
	if command == "" {
		http.Error(w, "Command is required", http.StatusBadRequest)
		return
	}

	timeoutMs := 0
	var timeout time.Duration
	if payload.TimeoutMs != nil {
		if *payload.TimeoutMs < 0 {
			http.Error(w, "timeout_ms must be non-negative", http.StatusBadRequest)
			return
		}
		timeoutMs = *payload.TimeoutMs
		timeout = time.Duration(*payload.TimeoutMs) * time.Millisecond
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/jsonlines")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)

	baseCtx := context.Background()
	clientCtx := r.Context()
	var cancel context.CancelFunc
	if timeout > 0 {
		baseCtx, cancel = context.WithTimeout(baseCtx, timeout)
	} else {
		baseCtx, cancel = context.WithCancel(baseCtx)
	}
	defer cancel()

	go func() {
		select {
		case <-clientCtx.Done():
			cancel()
		case <-baseCtx.Done():
		}
	}()

	cmd := exec.CommandContext(baseCtx, "/bin/sh", "-c", command)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = writeJSONLine(w, flusher, execEvent{
			Type:    "error",
			Message: fmt.Sprintf("stdout pipe failed: %v", err),
		})
		exitCode := 127
		_ = writeJSONLine(w, flusher, execEvent{Type: "exit", Code: &exitCode})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = writeJSONLine(w, flusher, execEvent{
			Type:    "error",
			Message: fmt.Sprintf("stderr pipe failed: %v", err),
		})
		exitCode := 127
		_ = writeJSONLine(w, flusher, execEvent{Type: "exit", Code: &exitCode})
		return
	}

	if err := cmd.Start(); err != nil {
		_ = writeJSONLine(w, flusher, execEvent{
			Type:    "error",
			Message: fmt.Sprintf("spawn failed: %v", err),
		})
		exitCode := 127
		_ = writeJSONLine(w, flusher, execEvent{Type: "exit", Code: &exitCode})
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go readPipe(clientCtx, stdout, "stdout", &wg, w, flusher)
	go readPipe(clientCtx, stderr, "stderr", &wg, w, flusher)

	waitErr := cmd.Wait()
	wg.Wait()

	exitCode := 0
	ctxErr := baseCtx.Err()
	if waitErr != nil {
		var exitErr *exec.ExitError
		switch {
		case errors.Is(ctxErr, context.DeadlineExceeded):
			message := fmt.Sprintf("timeout after %dms", timeoutMs)
			_ = writeJSONLine(w, flusher, execEvent{Type: "error", Message: message})
			exitCode = 124
		case errors.Is(ctxErr, context.Canceled) && clientCtx.Err() != nil:
			_ = writeJSONLine(w, flusher, execEvent{
				Type:    "error",
				Message: "request canceled by client",
			})
			exitCode = 1
		case errors.As(waitErr, &exitErr):
			exitCode = exitErr.ExitCode()
		default:
			_ = writeJSONLine(w, flusher, execEvent{
				Type:    "error",
				Message: fmt.Sprintf("wait failed: %v", waitErr),
			})
			exitCode = 1
		}
	}

	_ = writeJSONLine(w, flusher, execEvent{Type: "exit", Code: &exitCode})
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func determinePort(flagPort int) int {
	if env := strings.TrimSpace(os.Getenv("EXECD_PORT")); env != "" {
		if value, err := strconv.Atoi(env); err == nil && value > 0 && value < 65536 {
			return value
		}
	}
	if flagPort > 0 && flagPort < 65536 {
		return flagPort
	}
	return 39375
}

func main() {
	portFlag := flag.Int("port", 39375, "port to listen on")
	flag.Parse()

	port := determinePort(*portFlag)
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/exec", execHandler)

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       0,
		WriteTimeout:      0,
		IdleTimeout:       0,
	}

	log.Printf("cmux exec daemon listening on http://0.0.0.0:%d", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}
