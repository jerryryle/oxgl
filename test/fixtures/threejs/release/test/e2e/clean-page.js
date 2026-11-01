// A stand-in for three.js's test/e2e/clean-page.js: presses a start button.
( function () {
	const button = document.getElementById( 'startButton' );
	if ( button ) button.click();
	window.cleaned = true;
}() );
