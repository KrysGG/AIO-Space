/** A one-scriptlet library in uBlock's resources.json format: `aio-test(name, value)` sets window[name]. */
export const TEST_RESOURCES = JSON.stringify({
  scriptlets: [{ name: 'aio-test.js', aliases: [], body: "function aioTest(name = '', value = '') { window[name] = value; }", dependencies: [] }],
  redirects: [],
});
