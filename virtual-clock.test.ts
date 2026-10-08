import assert from 'node:assert/strict';
import vm from 'node:vm';
import { injectVirtualClock, VIRTUAL_CLOCK_SOURCE } from './virtual-clock';

function clock() {
  const context = vm.createContext({ performance: {}, document: { getAnimations: () => [] },
    CustomEvent: class { constructor(public type: string, public init: unknown) {} },
    setTimeout, setInterval });
  vm.runInContext('window=globalThis; addEventListener=()=>{}; dispatchEvent=()=>{};', context);
  vm.runInContext(VIRTUAL_CLOCK_SOURCE, context);
  return context;
}
const context = clock();
vm.runInContext(`const origin=performance.now(); let calls=0, position=0;
  function frame(){ calls++; position=100*(performance.now()-origin)/1000; requestAnimationFrame(frame); }
  requestAnimationFrame(frame);`, context);
for (const seconds of [0, 0.5, 1, 0.5, 0]) {
  vm.runInContext(`__TIMECUT_SET_TIME__(${seconds})`, context);
  assert.equal(vm.runInContext('position', context), seconds * 100, 'absolute time supports replay and reverse seek');
  assert.equal(vm.runInContext('Date.now()', context), seconds * 1000);
}
assert.equal(vm.runInContext('calls', context), 5, 'one RAF callback per tick');
assert.equal(vm.runInContext('setTimeout', context), setTimeout, 'readiness timeout is not disabled');
const canceled = clock();
vm.runInContext('let calls=0; const id=requestAnimationFrame(()=>calls++); cancelAnimationFrame(id); __TIMECUT_SET_TIME__(0)', canceled);
assert.equal(vm.runInContext('calls', canceled), 0);
const broken = clock();
vm.runInContext(`requestAnimationFrame(()=>{ throw new Error('drawing broke'); });`, broken);
assert.throws(() => vm.runInContext('__TIMECUT_SET_TIME__(0)', broken), /drawing broke/);
assert.throws(() => vm.runInContext('__TIMECUT_SET_TIME__(1)', broken), /drawing broke/, 'failure remains fatal');
const html = injectVirtualClock('<!DOCTYPE html><html><head><script>const origin=performance.now()</script></head></html>');
assert.ok(html.indexOf('let virtualMs') < html.indexOf('const origin'), 'clock precedes scene initialization');
assert.throws(() => injectVirtualClock('<html></html>'), /missing head/);
console.log('virtual clock checks passed');
