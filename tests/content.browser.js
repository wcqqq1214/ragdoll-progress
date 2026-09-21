(async () => {
  const results = [];
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  window.chrome.runtime = { getURL: (path) => path };
  // Expose internal functions only in this in-memory test copy. Production has
  // no test exports and retains its normal installation/navigation observers.
  const startup = '  queueInstall();\n  observeHistoryChanges();\n  observePage();';
  if (!extensionSource.includes(startup)) throw new Error('Test bootstrap is stale');
  (0, eval)(extensionSource.replace(startup,
    'window.testApi = { installForTarget, clearActiveLayer, getNativeProgressRatio };'));
  const api = window.testApi;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (actual, expected) => assert(actual === expected, `${actual} !== ${expected}`);
  const close = (actual, expected) => assert(Math.abs(actual - expected) < 0.00001,
    `${actual} != ${expected}`);
  const tick = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = [...frames.entries()];
    for (const [id, callback] of pending) {
      frames.delete(id);
      callback();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  let fixture;
  function makeTarget({ chapters = false, paused = true, widthProgress = true } = {}) {
    const player = document.createElement('div');
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = 'width:400px;height:10px;display:flex;';
    player.append(progressContainer);
    document.body.append(player);
    const fills = [];
    if (widthProgress) {
      for (let i = 0; i < (chapters ? 4 : 1); i++) {
        const segment = document.createElement('div');
        segment.style.cssText = `flex:none;width:${chapters ? 100 : 400}px;height:10px;`;
        const fill = document.createElement('div');
        fill.className = 'ytp-play-progress';
        fill.style.cssText = 'width:100%;height:10px;transform-origin:left;transform:scaleX(0);';
        segment.append(fill);
        progressContainer.append(segment);
        fills.push(fill);
      }
    }
    const video = document.createElement('video');
    const state = { paused, ended: false, duration: 100, currentTime: 25 };
    for (const key of Object.keys(state)) {
      Object.defineProperty(video, key, { get: () => state[key] });
    }
    player.append(video);
    return { site: { id: 'youtube' }, player, progressContainer, video, state, fills };
  }
  const layer = (target = fixture) => target.progressContainer.querySelector('.dcb-cat-progress');
  const progress = () => Number(layer().style.getPropertyValue('--dcb-progress'));
  const runnerStyle = () => getComputedStyle(layer().querySelector('.dcb-runner'));
  const fillTo = (index, ratio, target = fixture) => {
    target.fills[index].style.transform = `scaleX(${ratio})`;
  };
  async function test(name, fn) {
    try {
      await fn();
      results.push(`PASS ${name}`);
    } catch (error) {
      results.push(`FAIL ${name}: ${error.message}`);
    } finally {
      api.clearActiveLayer();
      document.querySelectorAll('body > div').forEach((element) => element.remove());
      frames.clear();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  await test('single bar keeps transformed native progress ahead of video time', async () => {
    fixture = makeTarget();
    fillTo(0, 0.625);
    api.installForTarget(fixture);
    await tick();
    equal(progress(), 0.625);
  });
  await test('chapters use the whole track and ignore empty later chapters', async () => {
    fixture = makeTarget({ chapters: true });
    close(api.getNativeProgressRatio(fixture.progressContainer), 0);
    fillTo(0, 1);
    close(api.getNativeProgressRatio(fixture.progressContainer), 0.25);
    fillTo(1, 0.5);
    close(api.getNativeProgressRatio(fixture.progressContainer), 0.375);
    fixture.fills.forEach((_, i) => fillTo(i, 1));
    close(api.getNativeProgressRatio(fixture.progressContainer), 1);
  });
  await test('chapter gaps and an offset track preserve the painted edge', async () => {
    fixture = makeTarget({ chapters: true });
    fixture.progressContainer.style.cssText += 'margin-left:73px;gap:4px;width:412px;';
    fillTo(0, 1);
    fillTo(1, 0.5);
    close(api.getNativeProgressRatio(fixture.progressContainer), 154 / 412);
  });
  await test('ARIA and video time fallbacks still work', async () => {
    fixture = makeTarget({ widthProgress: false });
    fixture.progressContainer.setAttribute('aria-valuemin', '0');
    fixture.progressContainer.setAttribute('aria-valuemax', '200');
    fixture.progressContainer.setAttribute('aria-valuenow', '150');
    api.installForTarget(fixture);
    await tick();
    equal(progress(), 0.75);
    fixture.progressContainer.removeAttribute('aria-valuenow');
    await tick();
    equal(progress(), 0.25);
  });
  await test('hidden chapter track falls back to video time', async () => {
    fixture = makeTarget({ chapters: true });
    fixture.progressContainer.style.display = 'none';
    api.installForTarget(fixture);
    await tick();
    equal(progress(), 0.25);
  });
  await test('paused video settles without a self-triggered RAF loop', async () => {
    fixture = makeTarget();
    api.installForTarget(fixture);
    await tick();
    equal(frames.size, 0);
    assert(layer().classList.contains('dcb-paused'), 'pause class missing');
    equal(runnerStyle().animationName, 'none');
    equal(runnerStyle().backgroundPositionX, '-504px');
    await tick();
    equal(frames.size, 0);
  });
  await test('play resumes continuous updates and pause stops them', async () => {
    fixture = makeTarget();
    api.installForTarget(fixture);
    await tick();
    fixture.state.paused = false;
    fixture.video.dispatchEvent(new Event('play'));
    await tick();
    equal(frames.size, 1);
    assert(!layer().classList.contains('dcb-paused'), 'pause class remained');
    equal(runnerStyle().animationName, 'dcb-run');
    equal(runnerStyle().backgroundSize, '800% 100%');
    fixture.state.paused = true;
    fixture.video.dispatchEvent(new Event('pause'));
    await tick();
    equal(frames.size, 0);
    equal(runnerStyle().animationName, 'none');
    equal(runnerStyle().backgroundPositionX, '-504px');
  });
  await test('paused native slider mutations update without media events', async () => {
    fixture = makeTarget();
    api.installForTarget(fixture);
    await tick();
    fillTo(0, 0.7);
    await tick();
    equal(progress(), 0.7);
    equal(frames.size, 0);
  });
  await test('paused drag tracks native progress until release outside the bar', async () => {
    fixture = makeTarget();
    api.installForTarget(fixture);
    await tick();
    fixture.progressContainer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fillTo(0, 0.8);
    await tick();
    equal(progress(), 0.8);
    equal(frames.size, 1);
    window.dispatchEvent(new PointerEvent('pointerup'));
    await tick();
    equal(frames.size, 0);
  });
  await test('keyboard/media seeking updates a paused video fallback', async () => {
    fixture = makeTarget({ widthProgress: false });
    api.installForTarget(fixture);
    await tick();
    fixture.state.currentTime = 60;
    fixture.video.dispatchEvent(new Event('seeked'));
    await tick();
    equal(progress(), 0.6);
    equal(frames.size, 0);
  });
  await test('ended video renders its final position and stops', async () => {
    fixture = makeTarget({ paused: false });
    api.installForTarget(fixture);
    await tick();
    fillTo(0, 1);
    fixture.state.ended = true;
    fixture.video.dispatchEvent(new Event('ended'));
    await tick();
    equal(progress(), 1);
    equal(frames.size, 0);
    assert(layer().classList.contains('dcb-ended'), 'ended class missing');
    equal(runnerStyle().animationName, 'none');
    equal(runnerStyle().backgroundPositionX, '-588px');
    // Real ended videos can be paused as well; the sleeping pose must win.
    fixture.state.paused = true;
    fixture.video.dispatchEvent(new Event('pause'));
    await tick();
    equal(runnerStyle().backgroundPositionX, '-588px');
  });
  await test('reinstalling the same target preserves the layer and restoration', async () => {
    fixture = makeTarget();
    api.installForTarget(fixture);
    const originalLayer = layer();
    api.installForTarget(fixture);
    equal(layer(), originalLayer);
    api.clearActiveLayer();
    equal(fixture.progressContainer.style.position, '');
    equal(fixture.player.className, '');
    equal(fixture.progressContainer.className, '');
  });
  await test('switching restores old hosts and detaches old event listeners', async () => {
    fixture = makeTarget({ paused: false });
    api.installForTarget(fixture);
    await tick();
    const old = fixture;
    fixture = makeTarget();
    api.installForTarget(fixture);
    await tick();
    equal(old.player.className, '');
    equal(old.progressContainer.className, '');
    equal(old.progressContainer.style.position, '');
    equal(layer(old), null);
    old.video.dispatchEvent(new Event('play'));
    fillTo(0, 0.5, old);
    await new Promise((resolve) => setTimeout(resolve, 0));
    equal(frames.size, 0);
    equal(document.querySelectorAll('.dcb-cat-progress').length, 1);
  });
  await test('cleanup restores an original inline static !important value', async () => {
    fixture = makeTarget();
    fixture.progressContainer.style.setProperty('position', 'static', 'important');
    api.installForTarget(fixture);
    equal(fixture.progressContainer.style.position, 'relative');
    api.clearActiveLayer();
    equal(fixture.progressContainer.style.position, 'static');
    equal(fixture.progressContainer.style.getPropertyPriority('position'), 'important');
  });
  await test('cleanup preserves existing classes and newer site positioning', async () => {
    fixture = makeTarget();
    fixture.player.className = 'dcb-cat-enhanced original';
    fixture.progressContainer.className = 'dcb-progress-host';
    api.installForTarget(fixture);
    fixture.progressContainer.style.position = 'absolute';
    api.clearActiveLayer();
    equal(fixture.progressContainer.style.position, 'absolute');
    equal(fixture.player.className, 'dcb-cat-enhanced original');
    equal(fixture.progressContainer.className, 'dcb-progress-host');
  });
  await test('detached layer can be reinstalled and fully cleaned up', async () => {
    fixture = makeTarget();
    api.installForTarget(fixture);
    layer().remove();
    api.installForTarget(fixture);
    await tick();
    assert(layer().isConnected, 'replacement layer missing');
    api.clearActiveLayer();
    equal(frames.size, 0);
    equal(fixture.progressContainer.style.position, '');
  });
  document.getElementById('results').textContent = results.join('\n');
})().catch((error) => {
  document.getElementById('results').textContent = `FAIL bootstrap: ${error.stack}`;
});
