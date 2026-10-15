(() => {
  const EXTENSION_CLASS = "dcb-cat-enhanced";
  const LAYER_CLASS = "dcb-cat-progress";
  const SPRITE_URL = chrome.runtime.getURL("assets/cat-sprite.png");
  // Explicit triggers (navigation, fullscreen, a new video playing) rescan
  // quickly. Background DOM churn such as danmaku only rechecks occasionally
  // while the current target is still healthy.
  const FAST_SCAN_DELAY = 150;
  const IDLE_SCAN_DELAY = 1000;

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
        "[class*='DivVideoDetailContainer']",
        "[role='dialog']",
        ".tiktok-web-player"
      ],
      progressSelectors: [
        "[aria-label='Playback progress']",
        "[class*='DivVideoProgressContainer']",
        "[aria-label='Video progress']",
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
  let activePlayer = null;
  let cleanupActiveTarget = null;
  let isScrubbing = false;
  let rafId = 0;
  let observer = null;
  let scanTimer = 0;
  let scanDueAt = 0;

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

    if (Number.isFinite(min) && Number.isFinite(max)) {
      return max > min ? clamp((value - min) / (max - min), 0, 1) : null;
    }

    // ARIA defaults a missing range to 0..100. A value outside it is most
    // likely in other units (seconds), so let the next source decide.
    const low = Number.isFinite(min) ? min : 0;
    const high = Number.isFinite(max) ? max : 100;
    if (high <= low || value < low || value > high) {
      return null;
    }

    return (value - low) / (high - low);
  }

  function readAriaProgressRatio(progressContainer) {
    const candidates = findAll(progressContainer, ["[aria-valuenow]"]);

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
      "[class*='ProgressBarElapsed']"
    ]);

    // Chapter bars each have their own parent. Their local width is not the
    // video's overall progress; use the last painted edge on the whole track.
    if (candidates.length > 1) {
      const trackRect = progressContainer.getBoundingClientRect();
      if (trackRect.width <= 0) {
        return null;
      }

      let playedEdge = trackRect.left;
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        // Unplayed chapters have zero width but start farther along the track.
        if (rect.width > 0) {
          playedEdge = Math.max(playedEdge, rect.right);
        }
      }

      return clamp((playedEdge - trackRect.left) / trackRect.width, 0, 1);
    }

    for (const candidate of candidates) {
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

    return readWidthProgressRatio(progressContainer)
      ?? readAriaProgressRatio(progressContainer);
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

  // Prefer playing, visible media with a known duration.
  function scoreMedia(video, visibleElement) {
    let score = 0;

    if (!video.paused && !video.ended) {
      score += 100;
    }

    if (isVisible(visibleElement)) {
      score += 50;
    }

    if (video.duration && Number.isFinite(video.duration)) {
      score += 10;
    }

    return score;
  }

  function pickBest(items, score) {
    let best = null;
    let bestScore = -Infinity;

    for (const item of items) {
      const value = score(item);
      if (value > bestScore) {
        best = item;
        bestScore = value;
      }
    }

    return best;
  }

  function findBestVideo(root, selectors) {
    return pickBest(findAll(root, selectors), (video) => scoreMedia(video, video));
  }

  function pickBestTarget(targets) {
    return pickBest(targets, (target) => scoreMedia(target.video, target.player));
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

  function prepareProgressHost(player, progressContainer) {
    const addedClasses = [
      [player, EXTENSION_CLASS],
      [progressContainer, "dcb-progress-host"]
    ].filter(([element, name]) => !element.classList.contains(name));
    addedClasses.forEach(([element, name]) => element.classList.add(name));

    const originalPosition = progressContainer.style.getPropertyValue("position");
    const originalPriority = progressContainer.style.getPropertyPriority("position");
    const changedPosition = window.getComputedStyle(progressContainer).position === "static";
    if (changedPosition) {
      progressContainer.style.position = "relative";
    }

    return () => {
      addedClasses.forEach(([element, name]) => element.classList.remove(name));
      // Preserve a newer position assigned by the site while we were attached.
      if (changedPosition && progressContainer.style.position === "relative"
        && progressContainer.style.getPropertyPriority("position") === "") {
        if (originalPosition) {
          progressContainer.style.setProperty("position", originalPosition, originalPriority);
        } else {
          progressContainer.style.removeProperty("position");
        }
      }
    };
  }

  function observeActiveTarget(video, progressContainer, layer) {
    const removers = [];
    const listen = (element, name, handler) => {
      element.addEventListener(name, handler, { capture: true, passive: true });
      removers.push(() => element.removeEventListener(name, handler, true));
    };
    for (const event of ["play", "playing", "pause", "ended", "seeking", "seeked",
      "timeupdate", "loadedmetadata", "durationchange", "emptied"]) {
      listen(video, event, startLoop);
    }

    listen(progressContainer, "pointerdown", () => {
      isScrubbing = true;
      startLoop();
    });
    const finishScrubbing = () => {
      if (isScrubbing) {
        isScrubbing = false;
        startLoop();
      }
    };
    listen(window, "pointerup", finishScrubbing);
    listen(window, "pointercancel", finishScrubbing);
    listen(window, "blur", finishScrubbing);
    listen(progressContainer, "keydown", startLoop);
    listen(progressContainer, "keyup", startLoop);

    // Native sliders can move before currentTime changes, including while paused.
    const progressObserver = new MutationObserver((records) => {
      if (records.some((record) => !layer.contains(record.target))) {
        startLoop();
      }
    });
    progressObserver.observe(progressContainer, {
      attributes: true,
      childList: true,
      subtree: true
    });

    return () => {
      progressObserver.disconnect();
      removers.forEach((remove) => remove());
    };
  }

  function updateLayer() {
    rafId = 0;
    if (!activeVideo || !activeLayer || !activeLayer.isConnected) {
      return;
    }

    const ratio = getNativeProgressRatio(activeProgressContainer)
      ?? getVideoProgressRatio(activeVideo);

    const progress = ratio.toFixed(5);
    if (activeLayer.style.getPropertyValue("--dcb-progress") !== progress) {
      activeLayer.style.setProperty("--dcb-progress", progress);
    }
    activeLayer.classList.toggle("dcb-paused", activeVideo.paused);
    activeLayer.classList.toggle("dcb-ended", activeVideo.ended);

    if ((!activeVideo.paused && !activeVideo.ended) || isScrubbing) {
      startLoop();
    }
  }

  function startLoop() {
    if (!rafId) {
      rafId = requestAnimationFrame(updateLayer);
    }
  }

  function clearActiveLayer() {
    if (cleanupActiveTarget) {
      cleanupActiveTarget();
      cleanupActiveTarget = null;
    }
    document.querySelectorAll(`.${LAYER_CLASS}`).forEach((layer) => layer.remove());

    activeVideo = null;
    activeProgressContainer = null;
    activeLayer = null;
    activePlayer = null;
    isScrubbing = false;

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
    if (activeVideo === video && activeProgressContainer === progressContainer
      && activePlayer === player && activeLayer && activeLayer.isConnected) {
      startLoop();
      return true;
    }

    // Removes every existing layer, so the new one is always the only one.
    clearActiveLayer();
    const layer = createLayer();
    layer.dataset.site = site.id;
    progressContainer.appendChild(layer);

    const restoreHost = prepareProgressHost(player, progressContainer);
    const stopObserving = observeActiveTarget(video, progressContainer, layer);
    cleanupActiveTarget = () => {
      stopObserving();
      restoreHost();
    };

    activePlayer = player;
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

  function findCurrentTarget() {
    const site = getCurrentSite();
    if (!site) {
      return null;
    }

    // Several selectors can match the same player element.
    const players = new Set();
    for (const selector of site.playerSelectors) {
      document.querySelectorAll(selector).forEach((player) => players.add(player));
    }

    const targets = [];
    for (const player of players) {
      const target = findTargetInPlayer(site, player);
      if (target) {
        targets.push(target);
      }
    }

    return pickBestTarget(targets);
  }

  function hasHealthyTarget() {
    return Boolean(activeLayer && activeLayer.isConnected
      && activeVideo && activeVideo.isConnected
      && activePlayer && activePlayer.isConnected);
  }

  // Schedule one rescan; an earlier request always wins over a later one.
  function scheduleScan(delay) {
    const dueAt = performance.now() + delay;
    if (scanTimer && scanDueAt <= dueAt) {
      return;
    }

    window.clearTimeout(scanTimer);
    scanDueAt = dueAt;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      installForTarget(findCurrentTarget());
    }, delay);
  }

  function queueInstall() {
    scheduleScan(FAST_SCAN_DELAY);
  }

  function handleDomMutations() {
    scheduleScan(hasHealthyTarget() ? IDLE_SCAN_DELAY : FAST_SCAN_DELAY);
  }

  // Media events do not bubble, but capture on document still sees them.
  function handleMediaPlay(event) {
    if (event.target instanceof HTMLMediaElement && event.target !== activeVideo) {
      queueInstall();
    }
  }

  function observePage() {
    observer = new MutationObserver(handleDomMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // Content scripts live in an isolated world, so patching history here would
    // not see the page's own pushState calls; the observers above cover SPA
    // navigation instead.
    window.addEventListener("yt-navigate-finish", queueInstall, true);
    window.addEventListener("popstate", queueInstall, true);
    window.addEventListener("pageshow", queueInstall, true);
    window.addEventListener("fullscreenchange", queueInstall, true);
    window.addEventListener("resize", queueInstall, { passive: true });
    document.addEventListener("play", handleMediaPlay, true);
    document.addEventListener("playing", handleMediaPlay, true);
  }

  queueInstall();
  observePage();
})();
