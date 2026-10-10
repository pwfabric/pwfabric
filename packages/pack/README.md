# @pwfabric/pack

Reads, validates, hashes and writes the pwpack folder and its `.pwpack`
archive. Node only, no runtime dependencies besides the contracts package.

```ts
import { readFolder, packContent, validatePack, writePwpack, readPwpack, hashPack, deriveManifest } from '@pwfabric/pack'

const source = await readFolder('./my-pack')        // folder on disk -> memory (tooling included)
const report = validatePack(source)                  // { ok, issues, identity, layout, atoms }
const pack = packContent(source)                     // only what belongs to the pack
const archive = await writePwpack(pack)              // deterministic gzipped tar
const again = await readPwpack(archive)              // archive -> memory (limits apply)
hashPack(again) === hashPack(pack)                   // content hash, framing-independent
const manifest = deriveManifest(pack, { archive })   // PwpackManifest
```

- **Folder**: `pwpack.json`, `app/`, `atoms/`, optional `media/` with
  `media/provenance.json`. `packContent` keeps those, root `LICENSE` /
  `NOTICE` / `README.md` and the legacy rootless atom families, and drops an
  author's tooling (`package.json`, `tsconfig.json`, `scripts/`, root
  `test/` …). `hashPack` hashes the pack content only, so a source folder
  and its archive have the same content hash.
- **Archive**: rootless ustar, byte-ordered names, mode 0644/0755, uid/gid 0,
  mtime 0, PAX `path` records for paths no ustar split fits; gzip level 9,
  header mtime 0, OS byte 3. Bytes are never transformed (CRLF stays CRLF).
- **Errors**: I/O and archive problems throw `PackError` with a `code`;
  content problems are returned by `validatePack` as issues.

See [COMPAT.md](./COMPAT.md) for how this matches the archives other tools
produce.

## License

Apache-2.0
