import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeEnvironment} from '../scripts/node-adapter.js';

test('public page serves an optional native developer disclosure after the weather report',async()=>{
 const response=await nodeEnvironment('/unused').ASSETS.fetch(new Request('http://localhost/'));
 assert.equal(response.status,200);
 const html=await response.text();
 const disclosure=html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
 assert.ok(disclosure,'Native details supplies keyboard and screen-reader disclosure behavior');
 assert.ok(!/\bopen\b/.test(disclosure[1]),'Technical content is collapsed by default');
 assert.match(disclosure[2],/^\s*<summary>How this works · Contribute<\/summary>/);
 assert.ok(html.indexOf('<details')>html.indexOf('</footer>'),'Primary weather experience stays first');
 for(const href of ['https://github.com/chungliwen/rlc-weather-web','https://github.com/chungliwen/rlc-weather-web/issues','https://github.com/chungliwen/rlc-weather-web/pulls']) assert.ok(disclosure[2].includes(`href="${href}"`));
 assert.match(disclosure[2],/independent of the club/);
 assert.match(disclosure[2],/IQAir[\s\S]*currently disabled/);
 assert.match(disclosure[2],/not a prediction/);
 assert.match(disclosure[2],/older than twenty minutes suppresses/);
 assert.ok(!/\/Users\/|\/srv\/|\.ssh\/|46\.62\.170\.28|157\.180\.25\.251|VPS_DEPLOY_KEY/.test(disclosure[2]),'No private deployment configuration is exposed');
});
