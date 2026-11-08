package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCompareReleaseVersions(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want int
	}{
		{"v0.10.1", "0.9.9", 1}, {"0.10.1", "v0.10.1", 0}, {"0.10.1", "0.11.0", -1},
		{"1.0.0", "1.0.0-beta.2", 1}, {"1.0.0-beta.10", "1.0.0-beta.2", 1},
		{"1.0.0-beta", "1.0.0-beta.1", -1}, {"1.0.0-1", "1.0.0-alpha", -1},
		{"1.0.0+first", "1.0.0+second", 0}, {"999999999999999999999.0.0", "999999999999999999998.0.0", 1},
	} {
		got, err := compareReleaseVersions(tc.a, tc.b)
		if err != nil || got != tc.want {
			t.Fatalf("%s vs %s: %d, %v", tc.a, tc.b, got, err)
		}
	}
	for _, version := range []string{"", "1.0", "01.0.0", "1.0.0-01", "1.0.0-", "vgarbage", "1.0.0+"} {
		if _, err := compareReleaseVersions(version, "1.0.0"); err == nil {
			t.Fatalf("accepted %q", version)
		}
	}
}

func TestCheckLatestRelease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("Accept") != "application/vnd.github+json" || r.Header.Get("User-Agent") != "ciip/"+Version {
			t.Errorf("unexpected release request: %s %v", r.Method, r.Header)
		}
		fmt.Fprint(w, `{"tag_name":"v0.10.1","draft":false,"prerelease":false}`)
	}))
	defer server.Close()
	for _, tc := range []struct{ current, status string }{{"0.9.9", "available"}, {"0.10.1", "up_to_date"}, {"0.11.0", "up_to_date"}, {"0.10.1-beta.1", "available"}} {
		result, err := checkLatestRelease(context.Background(), server.Client(), server.URL, tc.current)
		if err != nil || result.Status != tc.status || result.CurrentVersion != tc.current || result.LatestVersion != "0.10.1" {
			t.Fatalf("%s: %+v, %v", tc.current, result, err)
		}
		if (result.URL != "") != (tc.status == "available") {
			t.Fatalf("unexpected download action: %+v", result)
		}
	}
}

func TestUpdateFailuresNeverClaimLatest(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"rate limit", 403, ""}, {"throttled", 429, ""}, {"server", 502, ""},
		{"invalid JSON", 200, "not JSON"}, {"draft", 200, `{"tag_name":"v1.0.0","draft":true}`},
		{"preview", 200, `{"tag_name":"v1.0.0","prerelease":true}`}, {"preview tag", 200, `{"tag_name":"v1.0.0-beta.1"}`},
		{"invalid tag", 200, `{"tag_name":"vbad"}`}, {"no tag prefix", 200, `{"tag_name":"1.0.0"}`},
		{"oversized", 200, strings.Repeat("x", (1<<20)+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
			defer server.Close()
			result, err := checkLatestRelease(context.Background(), server.Client(), server.URL, "0.10.1")
			if err == nil || result.Status == "up_to_date" || result.LatestVersion != "" || result.URL != "" {
				t.Fatalf("failure became success: %+v %v", result, err)
			}
		})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) }))
	defer server.Close()
	result, err := checkLatestRelease(context.Background(), server.Client(), server.URL, "0.10.1")
	if err != nil || result.Status != "unavailable" {
		t.Fatalf("missing release: %+v %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := checkLatestRelease(ctx, server.Client(), server.URL, "0.10.1"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}

func TestUpdateRequestTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	client := server.Client()
	client.Timeout = 25 * time.Millisecond
	if _, err := checkLatestRelease(context.Background(), client, server.URL, "0.10.1"); err == nil {
		t.Fatal("a timed out request claimed success")
	}
}

func TestLiveReleaseCheck(t *testing.T) {
	if os.Getenv("CIIP_TEST_LIVE_UPDATES") != "1" {
		t.Skip("explicit live GitHub check")
	}
	result, err := checkLatestRelease(context.Background(), releaseHTTPClient, latestReleaseAPI, Version)
	if err != nil {
		t.Fatal(err)
	}
	if result.LatestVersion == "" {
		t.Fatalf("no official release: %+v", result)
	}
	t.Logf("GitHub Releases: status=%s current=%s latest=%s", result.Status, result.CurrentVersion, result.LatestVersion)
}
