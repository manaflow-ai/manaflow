package cli

import "testing"

func TestValidateStartProviderFlags(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		gpu      string
		runtime  string
		wantErr  bool
	}{
		{
			name:     "empty provider and no special flags",
			provider: "",
			gpu:      "",
			runtime:  "",
			wantErr:  false,
		},
		{
			name:     "e2b with gpu",
			provider: "e2b",
			gpu:      "T4",
			runtime:  "",
			wantErr:  true,
		},
		{
			name:     "e2b with runtime",
			provider: "e2b",
			gpu:      "",
			runtime:  "node24",
			wantErr:  true,
		},
		{
			name:     "modal with runtime",
			provider: "modal",
			gpu:      "",
			runtime:  "node24",
			wantErr:  true,
		},
		{
			name:     "modal with gpu",
			provider: "modal",
			gpu:      "T4",
			runtime:  "",
			wantErr:  false,
		},
		{
			name:     "vercel with gpu",
			provider: "vercel",
			gpu:      "T4",
			runtime:  "",
			wantErr:  true,
		},
		{
			name:     "vercel with runtime",
			provider: "vercel",
			gpu:      "",
			runtime:  "node22",
			wantErr:  false,
		},
		{
			name:     "unknown provider",
			provider: "unknown",
			gpu:      "",
			runtime:  "",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateStartProviderFlags(tt.provider, tt.gpu, tt.runtime)
			if tt.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("expected nil error, got %v", err)
			}
		})
	}
}
