// Runs before the page paints (loaded in <head>): applies the theme chosen
// earlier on this device, so a reload never flashes the wrong one.
// A separate file because the Content-Security-Policy allows no inline scripts.
try {
  var theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) {
  // storage blocked: follow the system
}
