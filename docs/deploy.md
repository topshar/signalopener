# Deploying to Vercel

You need a GitHub account and a Vercel account (sign up with GitHub; the free Hobby plan is enough for a demo).

## 1. Check the key isn't anywhere it shouldn't be
Your key belongs only in `.env.local`, which git ignores. In a terminal in the project folder:

```bash
git status
git grep -n "AIza" -- . ":!.env.local"
```

`git grep` should print nothing. If it prints a line, remove the key from that file before going further.

## 2. Put the code on GitHub
1. On github.com click **New repository**. Name it `signalopener`. Choose Public (easiest to share) or Private. Don't add a README, .gitignore or licence; the project already has them.
2. In the project folder:

```bash
git add -A
git commit -m "SignalOpener"
git branch -M main
git remote add origin https://github.com/<your-username>/signalopener.git
git push -u origin main
```

If git asks who you are, run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` first.

## 3. Deploy on Vercel
1. On vercel.com: **Add New → Project**, then **Import** the `signalopener` repository.
2. Leave the framework (Next.js) and build settings as detected.
3. Open **Environment Variables** and add:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | your key |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_THINKING_LEVEL` | `low` |
| `DAILY_RUN_LIMIT` | `100` (keeps reviewers from exhausting your free quota) |

4. Click **Deploy**. It takes a minute or two.

## 4. Check it really works
- Open the production URL in a private/incognito window (proves it's public).
- Enter a company website (for example joinekatra.com) and wait for a result.
- If you get "The AI provider isn't configured", the env vars weren't saved: add them under Project → Settings → Environment Variables, then **Redeploy**.
- Logs: Project → **Logs**. The `{"event":"generate",...}` lines are there.

## Later changes
Every `git push` to `main` redeploys automatically.
