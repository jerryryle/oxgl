// A stand-in for three.js's test/e2e/deterministic-injection.js with the
// same contract: seeded Math.random (the original as Math._random), a frozen
// clock, requestAnimationFrame callbacks held until _renderStarted and run
// once, and _videosReady. Math._seedPeek gives the next seeded value without
// drawing it, for the fixtures' own checks.
( function () {
	if ( globalThis._e2eInjected === true ) return;
	globalThis._e2eInjected = true;
	Math._random = Math.random;
	let seed = Math.PI / 4;
	const next = ( s ) => { const x = Math.sin( s ) * 10000; return x - Math.floor( x ); };
	Math.random = () => next( seed ++ );
	Math._seedPeek = () => next( seed );
	const now = () => 0;
	Date.now = now;
	performance.now = now;
	window._renderStarted = false;
	window._renderFinished = false;
	window.requestAnimationFrame = function ( cb ) {
		if ( window._renderFinished === true ) return;
		const id = setInterval( () => {
			if ( window._renderStarted === true ) {
				clearInterval( id );
				window._renderFinished = true;
				cb( now() );
			}
		}, 100 );
	};
	window._videosReady = () => true;
	window.TESTING = true;
}() );
