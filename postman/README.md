CFlairCounter Postman collection

Usage notes:
- The Postman environment `CFlairCounter.postman_environment.json` contains placeholders for `base_url`, `project`, and `admin_password`.
- For security, `admin_password` is intentionally left empty in the committed environment. Set it locally in Postman or supply it as an environment variable in CI (see `.github/workflows/newman.yml`).
- To run tests locally:
  1. Import the collection `postman/CFlairCounter.postman_collection.json` into Postman.
  2. Import the environment `postman/CFlairCounter.postman_environment.json` and set `admin_password` to your admin secret.
  3. Run `npm ci` then `npm run test:newman` to execute the collection tests.

CI notes:
- GitHub Actions expects two repository secrets: `BASE_URL` and `ADMIN_PASSWORD`. The workflow will inject them into the exported environment before running newman.
