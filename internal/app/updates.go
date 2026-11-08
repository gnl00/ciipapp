package app

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

const latestReleaseAPI = "https://api.github.com/repos/gnl00/ciipapp/releases/latest"
const releasePageURL = "https://github.com/gnl00/ciipapp/releases/latest"

var releaseHTTPClient = &http.Client{Timeout: 10 * time.Second}

type UpdateResult struct {
	Status         string `json:"status"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	URL            string `json:"url"`
	Message        string `json:"message"`
}

func (s *CaptureService) CheckForUpdates(ctx context.Context) (UpdateResult, error) {
	return checkLatestRelease(ctx, releaseHTTPClient, latestReleaseAPI, mygo.App.Version())
}

func (s *CaptureService) OpenUpdatePage() error { return mygo.Shell.OpenExternal(releasePageURL) }

func checkLatestRelease(ctx context.Context, client *http.Client, endpoint, current string) (UpdateResult, error) {
	result := UpdateResult{CurrentVersion: current}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return result, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "ciip/"+Version)
	response, err := client.Do(req)
	if err != nil {
		return result, fmt.Errorf("无法连接 GitHub，请检查网络后重试：%w", err)
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		result.Status, result.Message = "unavailable", "暂未获取到正式版本，请稍后重试。"
		return result, nil
	case http.StatusForbidden, http.StatusTooManyRequests:
		return result, errors.New("GitHub 请求受限，请稍后再试")
	default:
		return result, fmt.Errorf("GitHub 检查更新失败（HTTP %d），请稍后重试", response.StatusCode)
	}
	const limit = 1 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || len(data) > limit {
		return result, errors.New("无法读取 GitHub 版本信息，请稍后重试")
	}
	var release struct {
		Tag        string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if json.Unmarshal(data, &release) != nil || release.Draft || release.Prerelease || !strings.HasPrefix(release.Tag, "v") {
		return result, errors.New("GitHub 返回了无效的正式版本信息")
	}
	version := releaseVersionPattern.FindStringSubmatch(release.Tag)
	comparison, err := compareReleaseVersions(release.Tag, current)
	if err != nil || version == nil || version[4] != "" {
		return result, errors.New("无法比较当前版本与 GitHub 正式版本")
	}
	result.LatestVersion = strings.TrimPrefix(release.Tag, "v")
	if comparison > 0 {
		result.Status, result.URL = "available", releasePageURL
		result.Message = fmt.Sprintf("发现新版本 %s，当前版本为 %s。", result.LatestVersion, current)
	} else {
		result.Status = "up_to_date"
		if comparison == 0 {
			result.Message = fmt.Sprintf("当前版本 %s 已是最新正式版本。", current)
		} else {
			result.Message = fmt.Sprintf("当前版本 %s 不低于最新正式版本 %s。", current, result.LatestVersion)
		}
	}
	return result, nil
}

// Same SemVer 2.0 grammar as scripts/release.mjs; numeric strings avoid integer overflow.
var releaseVersionPattern = regexp.MustCompile(`^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)

func compareVersionNumber(a, b string) int {
	if order := cmp.Compare(len(a), len(b)); order != 0 {
		return order
	}
	return strings.Compare(a, b)
}

func compareReleaseVersions(a, b string) (int, error) {
	left, right := releaseVersionPattern.FindStringSubmatch(a), releaseVersionPattern.FindStringSubmatch(b)
	if left == nil || right == nil {
		return 0, errors.New("无效的 SemVer 版本")
	}
	for i := 1; i <= 3; i++ {
		if order := compareVersionNumber(left[i], right[i]); order != 0 {
			return order, nil
		}
	}
	if left[4] == "" || right[4] == "" {
		if left[4] == right[4] {
			return 0, nil
		}
		if left[4] == "" {
			return 1, nil
		}
		return -1, nil
	}
	l, r := strings.Split(left[4], "."), strings.Split(right[4], ".")
	for i := 0; i < min(len(l), len(r)); i++ {
		ln, rn := strings.Trim(l[i], "0123456789") == "", strings.Trim(r[i], "0123456789") == ""
		var order int
		switch {
		case ln && rn:
			order = compareVersionNumber(l[i], r[i])
		case ln:
			order = -1
		case rn:
			order = 1
		default:
			order = strings.Compare(l[i], r[i])
		}
		if order != 0 {
			return order, nil
		}
	}
	return cmp.Compare(len(l), len(r)), nil
}
