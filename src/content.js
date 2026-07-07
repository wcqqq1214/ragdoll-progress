(() => {
  const EXTENSION_CLASS = "dcb-cat-enhanced";
  const LAYER_CLASS = "dcb-cat-progress";
  const SPRITE_URL = chrome.runtime.getURL("assets/cat-sprite.png");
  const SITE_CLASS_PREFIX = "dcb-site-";

  const SITE_CONFIGS = [
    {
      id: "youtube",
      hostnames: ["youtube.com"],
      playerSelectors: [
        ".html5-video-player.ytp-fullscreen",
        "#movie_player.html5-video-player",
        ".html5-video-player"
      ],
      progressSelectors: [
        ".ytp-progress-bar-container"
      ],
      videoSelectors: [
        "video"
      ]
    },
    {
      id: "bilibili",
      hostnames: ["bilibili.com"],
      playerSelectors: [
        ".bpx-player-container[data-screen='full']",
        ".bpx-player-container[data-screen='web']",
        ".bpx-player-container",
        "#bilibili-player",
        ".bilibili-player"
      ],
      progressSelectors: [
        ".bpx-player-progress-area",
        ".bpx-player-progress-wrap",
        ".bpx-player-progress",
        ".bilibili-player-video-progress"
      ],
      videoSelectors: [
        "video"
      ]
    },
    {
      id: "douyin",
      hostnames: ["douyin.com"],
      playerSelectors: [
        ".xgplayer",
        ".xgplayer-pc",
        ".douyin-player",
        "[data-e2e='feed-active-video']",
        "[data-e2e='video-player']"
      ],
      progressSelectors: [
        ".xgplayer-progress",
        ".xgplayer-progress-outer",
        ".xgplayer-progress-inner",
        ".xg-progress",
        ".xg-progress-outer",
        ".xg-progress-inner",
        ".xg-mini-progress",
        "[data-e2e='video-progress']"
      ],
      videoSelectors: [
        "video"
      ]
    },
    {
      id: "tiktok",
      hostnames: ["tiktok.com"],
      pathPattern: /^\/@[^/]+\/video\/\d+/,
      playerSelectors: [
        "[data-e2e='feed-video']",
        "[class*='DivVideoDetailContainer']",
        "[role='dialog']",
        "[class*='DivVideoPlayerContainer']",
        ".xgplayer-container.tiktok-web-player",
        ".tiktok-web-player"
      ],
      progressSelectors: [
        "[class*='DivVideoProgressContainer']",
        "[class*='DivSeekBarContainer']",
        "[class*='DivProgressBarContainer']",
        "[class*='DivProgressBar'][class*='eer']",
        "[class*='DivSeekBarProgress']",
        "[aria-label='Video progress']",
        "[aria-label='Playback progress']",
        "[aria-label='progress bar']"
      ],
      videoSelectors: [
        "video"
      ]
    }
  ];

  let activeVideo = null;
  let activeProgressContainer = null;
  let activeLayer = null;
  let rafId = 0;
  let observer = null;
  let installQueued = false;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function getCurrentSite() {
    const hostname = window.location.hostname;

    return SITE_CONFIGS.find((site) => (
      site.hostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`))
        && (!site.pathPattern || site.pathPattern.test(window.location.pathname))
    ));
  }

  function findFirst(root, selectors) {
    for (const selector of selectors) {
      const match = root.querySelector(selector);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function findAll(root, selectors) {
    const matches = [];

    for (const selector of selectors) {
      if (root.matches && root.matches(selector)) {
        matches.push(root);
      }

      matches.push(...root.querySelectorAll(selector));
    }

    return matches;
  }

  function getAttributeNumber(element, name) {
    const value = Number.parseFloat(element.getAttribute(name));

    return Number.isFinite(value) ? value : null;
  }

  function normalizeProgressValue(value, min = null, max = null) {
    if (!Number.isFinite(value)) {
      return null;
    }

    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return clamp((value - min) / (max - min), 0, 1);
    }

    if (value >= 0 && value <= 1) {
      return value;
    }

    if (value >= 0 && value <= 100) {
      return value / 100;
    }

    return null;
  }

  function readAriaProgressRatio(progressContainer) {
    const candidates = findAll(progressContainer, [
      "[aria-label='Video progress'][aria-valuenow]",
      "[role='slider'][aria-valuenow]",
      "[aria-valuenow]"
    ]);

    for (const candidate of candidates) {
      const ratio = normalizeProgressValue(
        getAttributeNumber(candidate, "aria-valuenow"),
        getAttributeNumber(candidate, "aria-valuemin"),
        getAttributeNumber(candidate, "aria-valuemax")
      );

      if (ratio !== null) {
        return ratio;
      }
    }

    return null;
  }

  function readWidthProgressRatio(progressContainer) {
    const candidates = findAll(progressContainer, [
      ".ytp-play-progress",
      "[class*='ProgressBarElapsed']",
      "[class*='progress-played']",
      "[class*='progressPlayed']",
      "[class*='ProgressPlayed']",
      "[class*='played']",
      "[class*='elapsed']",
      "[class*='Elapsed']"
    ]);

    for (const candidate of candidates) {
      const width = window.getComputedStyle(candidate).width;
      if (width.endsWith("%")) {
        const ratio = normalizeProgressValue(Number.parseFloat(width));
        if (ratio !== null) {
          return ratio;
        }
      }

      const parentRect = candidate.parentElement && candidate.parentElement.getBoundingClientRect();
      const rect = candidate.getBoundingClientRect();
      if (parentRect && parentRect.width > 0 && rect.width >= 0) {
        return clamp(rect.width / parentRect.width, 0, 1);
      }
    }

    return null;
  }

  function getNativeProgressRatio(progressContainer) {
    if (!progressContainer || !progressContainer.isConnected) {
      return null;
    }

    return readAriaProgressRatio(progressContainer)
      ?? readWidthProgressRatio(progressContainer);
  }

  function getVideoProgressRatio(video) {
    const duration = video.duration;

    return duration && Number.isFinite(duration)
      ? clamp(video.currentTime / duration, 0, 1)
      : 0;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();

    return rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth;
  }

  function scoreTarget(target) {
    let score = 0;

    if (!target.video.paused && !target.video.ended) {
      score += 100;
    }

    if (isVisible(target.player)) {
      score += 50;
    }

    if (target.video.duration && Number.isFinite(target.video.duration)) {
      score += 10;
    }

    return score;
  }

  function scoreVideo(video) {
    let score = 0;

    if (!video.paused && !video.ended) {
      score += 100;
    }

    if (isVisible(video)) {
      score += 50;
    }

    if (video.duration && Number.isFinite(video.duration)) {
      score += 10;
    }

    return score;
  }

  function pickBestVideo(videos) {
    if (!videos.length) {
      return null;
    }

    return videos.reduce((best, video) => (
      scoreVideo(video) > scoreVideo(best) ? video : best
    ));
  }

  function findBestVideo(root, selectors) {
    return pickBestVideo(findAll(root, selectors));
  }

  function pickBestTarget(targets) {
    if (!targets.length) {
      return null;
    }

    return targets.reduce((best, target) => (
      scoreTarget(target) > scoreTarget(best) ? target : best
    ));
  }

  function createLayer() {
    const layer = document.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--dcb-cat-sprite", `url("${SPRITE_URL}")`);
    layer.style.setProperty("--dcb-progress", "0");

    layer.innerHTML = `
      <div class="dcb-runner"></div>
    `;

    return layer;
  }

  function prepareProgressHost(progressContainer) {
    progressContainer.classList.add("dcb-progress-host");

    if (window.getComputedStyle(progressContainer).position === "static") {
      progressContainer.style.position = "relative";
    }
  }

  function updateLayer() {
    if (!activeVideo || !activeLayer || !activeLayer.isConnected) {
      rafId = 0;
      return;
    }

    const ratio = getNativeProgressRatio(activeProgressContainer)
      ?? getVideoProgressRatio(activeVideo);

    activeLayer.style.setProperty("--dcb-progress", ratio.toFixed(5));
    activeLayer.classList.toggle("dcb-paused", activeVideo.paused);
    activeLayer.classList.toggle("dcb-ended", activeVideo.ended);

    rafId = requestAnimationFrame(updateLayer);
  }

  function startLoop() {
    if (!rafId) {
      rafId = requestAnimationFrame(updateLayer);
    }
  }

  function clearActiveLayer() {
    document.querySelectorAll(`.${LAYER_CLASS}`).forEach((layer) => layer.remove());

    activeVideo = null;
    activeProgressContainer = null;
    activeLayer = null;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function installForTarget(target) {
    if (!target) {
      clearActiveLayer();
      return false;
    }

    const { site, player, progressContainer, video } = target;
    let layer = progressContainer.querySelector(`.${LAYER_CLASS}`);
    if (!layer) {
      layer = createLayer();
      progressContainer.appendChild(layer);
    }

    document.querySelectorAll(`.${LAYER_CLASS}`).forEach((existingLayer) => {
      if (existingLayer !== layer) {
        existingLayer.remove();
      }
    });

    layer.dataset.site = site.id;
    player.classList.add(EXTENSION_CLASS, `${SITE_CLASS_PREFIX}${site.id}`);
    prepareProgressHost(progressContainer);

    activeVideo = video;
    activeProgressContainer = progressContainer;
    activeLayer = layer;
    startLoop();
    return true;
  }

  function findTargetInPlayer(site, player) {
    const progressContainer = findFirst(player, site.progressSelectors);
    const video = findBestVideo(player, site.videoSelectors);

    if (!progressContainer || !video) {
      return null;
    }

    return {
      site,
      player,
      progressContainer,
      video
    };
  }

  function findFallbackTarget(site) {
    const progressContainer = findFirst(document, site.progressSelectors);
    if (!progressContainer) {
      return null;
    }

    const player = progressContainer.closest(site.playerSelectors.join(","));
    if (!player) {
      return null;
    }

    const video = findBestVideo(player, site.videoSelectors)
      || findBestVideo(document, site.videoSelectors);
    if (!video) {
      return null;
    }

    return {
      site,
      player,
      progressContainer,
      video
    };
  }

  function findCurrentTarget() {
    const site = getCurrentSite();
    if (!site) {
      return null;
    }

    const targets = [];

    for (const selector of site.playerSelectors) {
      for (const player of document.querySelectorAll(selector)) {
        const target = findTargetInPlayer(site, player);
        if (target) {
          targets.push(target);
        }
      }
    }

    const fallbackTarget = findFallbackTarget(site);
    if (fallbackTarget) {
      targets.push(fallbackTarget);
    }

    return pickBestTarget(targets);
  }

  function queueInstall() {
    if (installQueued) {
      return;
    }

    installQueued = true;
    window.setTimeout(() => {
      installQueued = false;
      installForTarget(findCurrentTarget());
    }, 150);
  }

  function observePage() {
    observer = new MutationObserver(queueInstall);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("yt-navigate-finish", queueInstall, true);
    window.addEventListener("popstate", queueInstall, true);
    window.addEventListener("dcb-location-change", queueInstall, true);
    window.addEventListener("pageshow", queueInstall, true);
    window.addEventListener("fullscreenchange", queueInstall, true);
    window.addEventListener("resize", queueInstall, { passive: true });
  }

  function observeHistoryChanges() {
    if (window.__dcbHistoryObserved) {
      return;
    }

    window.__dcbHistoryObserved = true;

    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("dcb-location-change"));
        window.setTimeout(queueInstall, 600);
        window.setTimeout(queueInstall, 1400);
        return result;
      };
    }
  }

  queueInstall();
  observeHistoryChanges();
  observePage();
})();
