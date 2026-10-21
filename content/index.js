// Every subject file must be imported here. Static imports make bundlers
// (such as Vercel's) ship the JSON alongside the server code.
import math from './math.json' with { type: 'json' };
import reading from './reading.json' with { type: 'json' };

export default [math, reading];
