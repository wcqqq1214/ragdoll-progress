# Ragdoll Progress

A small Chrome extension that keeps native video progress bars intact and adds a cute running ragdoll cat above the scrubber.

The cat is inspired by Fanqie: a fluffy white ruff, a pointed white nose blaze,
and a plush brown tail. It runs during playback, rests with tucked paws when
paused, and curls up asleep when the video ends. Reduced-motion preferences
replace running with the resting pose.

<p align="center">
  <img src="assets/ragdoll-progress.gif" alt="Running ragdoll cat animation" width="420">
</p>

Open [the interactive preview](assets/preview.html) locally to see all three states
at their actual display size and try the enlarged preview.

## Supported Platforms

[![YouTube](https://img.shields.io/badge/YouTube-video%20pages-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/)
[![Bilibili](https://img.shields.io/badge/Bilibili-video%20pages-00A1D6?logo=bilibili&logoColor=white)](https://www.bilibili.com/)
[![Douyin](https://img.shields.io/badge/Douyin-web%20videos-000000?logo=tiktok&logoColor=white)](https://www.douyin.com/)
[![TikTok](https://img.shields.io/badge/TikTok-web%20videos-000000?logo=tiktok&logoColor=white)](https://www.tiktok.com/)

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned `ragdoll-progress` folder, which contains `manifest.json`.
5. Open or refresh a supported video page.

## Regression Tests

Run `node scripts/test.mjs` with Node.js and Google Chrome installed. On macOS,
the runner uses Chrome's standard application path; elsewhere, set `CHROME_PATH`
to the Chrome executable.

The tests use a temporary browser profile and local fixtures to check native
progress geometry, paused seeking, playback updates, and cleanup. They do not
access your normal browser profile or replace live platform compatibility checks.

## License

MIT
