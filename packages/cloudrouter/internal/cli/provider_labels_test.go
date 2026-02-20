package cli

import (
	"testing"

	"github.com/manaflow-ai/cloudrouter/internal/api"
)

func TestInstanceTypeLabel(t *testing.T) {
	tests := []struct {
		name string
		inst api.Instance
		want string
	}{
		{
			name: "docker default",
			inst: api.Instance{Provider: "e2b"},
			want: "Docker",
		},
		{
			name: "modal with gpu",
			inst: api.Instance{Provider: "modal", GPU: "T4"},
			want: "GPU (T4)",
		},
		{
			name: "vercel with runtime",
			inst: api.Instance{Provider: "vercel", Runtime: "node22"},
			want: "Vercel (node22)",
		},
		{
			name: "vercel without runtime",
			inst: api.Instance{Provider: "vercel"},
			want: "Vercel",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := instanceTypeLabel(tt.inst)
			if got != tt.want {
				t.Fatalf("instanceTypeLabel() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTemplateTypeLabel(t *testing.T) {
	tests := []struct {
		name string
		tpl  api.Template
		want string
	}{
		{
			name: "docker default",
			tpl:  api.Template{Provider: "e2b"},
			want: "Docker",
		},
		{
			name: "modal with gpu",
			tpl:  api.Template{Provider: "modal", GPU: "A10G"},
			want: "GPU (A10G)",
		},
		{
			name: "vercel with runtime",
			tpl:  api.Template{Provider: "vercel", Runtime: "python3.13"},
			want: "Vercel (python3.13)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := templateTypeLabel(tt.tpl)
			if got != tt.want {
				t.Fatalf("templateTypeLabel() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCreateResponseTypeLabel(t *testing.T) {
	tests := []struct {
		name             string
		resp             *api.CreateInstanceResponse
		requestedRuntime string
		want             string
	}{
		{
			name:             "docker default",
			resp:             &api.CreateInstanceResponse{Provider: "e2b"},
			requestedRuntime: "",
			want:             "Docker",
		},
		{
			name:             "modal with gpu",
			resp:             &api.CreateInstanceResponse{Provider: "modal", GPU: "L4"},
			requestedRuntime: "",
			want:             "GPU (L4)",
		},
		{
			name:             "vercel runtime from response",
			resp:             &api.CreateInstanceResponse{Provider: "vercel", Runtime: "node22"},
			requestedRuntime: "",
			want:             "Vercel (node22)",
		},
		{
			name:             "vercel runtime from request fallback",
			resp:             &api.CreateInstanceResponse{Provider: "vercel"},
			requestedRuntime: "python3.13",
			want:             "Vercel (python3.13)",
		},
		{
			name:             "vercel runtime default fallback",
			resp:             &api.CreateInstanceResponse{Provider: "vercel"},
			requestedRuntime: "",
			want:             "Vercel (node24)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := createResponseTypeLabel(tt.resp, tt.requestedRuntime)
			if got != tt.want {
				t.Fatalf("createResponseTypeLabel() = %q, want %q", got, tt.want)
			}
		})
	}
}
