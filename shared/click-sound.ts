// The bundled default mouse-click sound.
//
// Lives in the Vite `public/` dir, so it is copied to the renderer dist on
// build and served as a static asset. Both processes reach it the same way:
// the renderer loads `DEFAULT_CLICK_SOUND` through the `media://` handler and
// the main process joins it against `VITE_PUBLIC` (public/ in dev, dist/ in
// prod) to hand FFmpeg a real path. One filename keeps preview and export on
// the same sound.
export const DEFAULT_CLICK_SOUND = 'default_mouse_click.mp3'
