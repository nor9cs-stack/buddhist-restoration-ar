# Buddhist Statue Restoration WebAR

Mobile-first WebAR site for a Buddhist statue restoration project. The AR experience is available at `/ar`.

## Deploy to Vercel

1. Push this project to a Git repository.
2. Import the repository in Vercel.
3. Keep the default framework preset as Next.js.
4. Use the default build command:
   ```bash
   npm run build
   ```
5. Deploy the project, then open the AR page at:
   ```text
   https://your-vercel-domain.vercel.app/ar
   ```

The MindAR target file and GLB model are served from the public folder with production-safe absolute paths:

```text
/targets/buddha_targets.mind
/models/buddha_001.glb
```

Mobile browsers require HTTPS for camera access in production. Vercel deployments are served over HTTPS by default, so the AR camera permission flow should work from the deployed `/ar` route after the placeholder target and model files are replaced with valid assets.

## Optimize GLB for Mobile WebAR

Do not commit the current large GLB to Git. GitHub blocks files over 100MB, and mobile WebAR should ideally use a production GLB under 20MB for faster loading, lower memory use, and better camera tracking stability.

Recommended optimization workflow:

1. Keep the original high-resolution model outside Git as a source asset.
2. In Blender, remove hidden/internal geometry, apply transforms, merge duplicate vertices, and export only the objects needed for AR.
3. Use mesh decimation carefully on dense statue surfaces, preserving the silhouette and restored cultural details.
4. Resize textures for mobile, usually 1024px or 2048px max, and remove unused materials or texture slots.
5. Prefer compressed textures such as KTX2/Basis where the runtime supports them.
6. Run glTF optimization tools such as `gltf-transform` to deduplicate, prune, resample, compress textures, and optionally apply mesh compression.

Example `gltf-transform` commands:

```bash
npx @gltf-transform/cli inspect source.glb
npx @gltf-transform/cli optimize source.glb public/models/buddha_001.glb --texture-compress webp --texture-size 2048
```

For stronger compression, test Draco or Meshopt output on the target phones before deployment:

```bash
npx @gltf-transform/cli optimize source.glb public/models/buddha_001.glb --compress meshopt --texture-compress webp --texture-size 2048
```

The production file should still be served at:

```text
/models/buddha_001.glb
```

If that file is missing after deployment, the AR page keeps the museum UI visible and shows a clear model-load fallback message instead of requesting camera access and failing silently.
