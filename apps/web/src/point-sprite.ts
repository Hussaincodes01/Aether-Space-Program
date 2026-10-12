/**
 * Shared vertex-shader code for the three point-sprite layers: stars, deep sky, exoplanets.
 */

/**
 * Discard a point whose centre is outside the clip volume.
 *
 * GLSL ES already requires this -- a point is drawn only if its centre lies inside the clip
 * volume -- so on a conformant GPU this line changes nothing. It is written out because
 * SwiftShader, the software rasterizer Chrome uses when there is no usable GPU, crashes the
 * whole GPU process (SIGFPE) on a sprite whose centre sits about a pixel outside the
 * viewport. Arriving at TRAPPIST-1 put one galaxy exactly there, and the WebGL context was
 * lost on every frame afterwards: the canvas went blank and stayed blank.
 *
 * Moving the vertex to z = 2w puts it beyond the far plane, so it is clipped before
 * rasterization. `w <= 0` (behind the camera) fails the test too and goes the same way.
 *
 * Must come after `gl_Position` is written and before `logdepthbuf_vertex`, which reads it.
 */
export const DISCARD_OFFSCREEN_POINT = /* glsl */ `
        if (any(greaterThan(abs(gl_Position.xy), vec2(gl_Position.w)))) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        }
`;
