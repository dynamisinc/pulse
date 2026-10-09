/**
 * features/social/explore/ExplorePage.tsx
 * ---------------------------------------------------------------------------
 * The Explore page (demo-polish F0 STUB). Created here so the file exists before
 * F6 (client-side trending / search / explore) starts and F1 (the router, which
 * mounts it at `/explore`) needs something to import; F6 owns this file and fills
 * in the trending list and search results. F0 mounts it nowhere (there is no
 * router yet — that is F1's).
 *
 * F0 STATE: a labelled landmark with just the page heading, so a route element
 * that mounts it before F6 lands is a real, accessible (if empty) page rather
 * than a blank one. The heading uses the shared `h1` role every participant page
 * exposes (see `pages/Feed.tsx`).
 *
 * Participant world — plain elements; no COBRA, no MUI. F6 supplies its own CSS
 * module in this directory.
 */

export function ExplorePage() {
  return (
    <section aria-labelledby="explore-heading" data-testid="explore-page">
      <h1 id="explore-heading">Explore</h1>
    </section>
  )
}
