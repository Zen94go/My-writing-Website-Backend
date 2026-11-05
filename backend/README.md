# Writing Site Backend

Node.js API for the writing site. It manages published articles, drafts, categories, pinned articles, likes, comments, and the private admin session. It uses Node.js built-in modules and does not require third-party packages.

## Run locally

Install Node.js, open a terminal in this repository, and set a local setup key before starting the service.

```powershell
$env:ADMIN_SETUP_KEY = "use-a-unique-local-secret-with-at-least-32-characters"
npm start
```

Open `http://localhost:3000`. When the site has no admin password yet, the admin panel asks for this setup key and a new password. The frontend repository can be kept beside this repository for local preview.

Local data is saved in `data/site.json` under this repository. To store it elsewhere, set `DATA_DIR` to an absolute directory before starting the service.

## Deploy to Render

This folder is designed to be the root of its own Git repository. Connect that repository to Render as a **Blueprint**; Render will find `render.yaml` at the repository root. The service uses `npm start` and listens on Render's `PORT` environment variable.

Set these environment variables in Render:

| Variable | Purpose |
| --- | --- |
| `ADMIN_SETUP_KEY` | Private, unique secret of at least 32 characters required to create the first admin password. Keep it out of Git and the frontend. |
| `FRONTEND_ORIGIN` | Exact Netlify site origin allowed to call this API. Add a custom frontend domain as another comma-separated origin if applicable. |
| `DATA_DIR` | Optional path to persistent storage. The default is `data/` in the service directory. |

After deploying, open the frontend's **Admin panel**, enter the setup key once, and create an admin password of at least 12 characters. There is no admin username or email. Setup is refused once an admin password exists.

### Persistent storage

The JSON database is the site's source of truth. Render's free web services have an ephemeral filesystem, and cannot attach persistent disks. Use a Render plan that supports a persistent disk, mount it, and set `DATA_DIR` to the mount path before relying on saved content. Back up the data directory regularly. See [Render's free service limits](https://render.com/docs/free) and [persistent disk guide](https://render.com/docs/disks).

## API overview

- `GET /api/site` — public published articles and categories
- `GET /api/posts/:slug` — a published article with comments and likes
- `POST /api/posts/:slug/comments` — add a public comment
- `POST /api/posts/:slug/like` — add a like
- `POST /api/setup`, `POST /api/login`, `POST /api/logout` — admin authentication
- `GET`, `POST`, and `DELETE /api/admin` — authenticated article management
- `POST`, `DELETE /api/admin/categories` — authenticated category management
- `DELETE /api/admin/comments` — authenticated comment removal

Admin endpoints require the bearer token returned at sign-in. Login and initial setup attempts are rate-limited. The admin password is stored as a salted scrypt hash; the setup key is read from the process environment and is not written to the JSON database.

## Privacy notes

Public comments store and display the commenter's chosen name, comment text, and date. Likes and basic rate limits use hashes derived from network addresses rather than storing the raw address in the JSON data file. Admin sessions are held in server memory and are cleared when the service restarts. Use HTTPS for public deployments and do not commit `data/`, `.env`, passwords, setup keys, or backups containing site data.
