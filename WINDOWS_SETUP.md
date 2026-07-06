# Running GoForKids on Windows

You'll run two programs — the **backend** (Go engine + AI) and the **frontend** (the game) — and play at **http://localhost:5173** in your browser. First-time setup takes about 20 minutes, mostly downloads.

**You need:** Windows 10 or 11 (64-bit), ~3 GB of free disk, and internet for the downloads. A graphics card (even built-in Intel) makes the AI faster but isn't required.

## 1. Install the tools

Install with default options, except where noted:

- **Git** — https://gitforwindows.org
- **Node.js (LTS)** — https://nodejs.org
- **Python** — https://www.python.org/downloads/ — tick **"Add python.exe to PATH"** on the first installer screen

Then open PowerShell and run this one-time line, which lets tools like `npm` run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Verify: `git --version`, `node --version`, and `python --version` should each print a version number.

## 2. Install KataGo

1. From https://github.com/lightvector/KataGo/releases, under the newest release's "Assets", download **`katago-v1.16.5-opencl-windows-x64.zip`** (the version number may be higher by the time you read this — grab the one ending in `opencl-windows-x64.zip`). It works with almost any graphics card. No graphics card? Use the `eigenavx2-windows-x64.zip` one instead.
2. Unzip so the program ends up at **`C:\katago\katago.exe`**.
3. Test it: `C:\katago\katago.exe version` should print a version. (Missing `VCRUNTIME140.dll`? See troubleshooting.)

## 3. Get the code

```powershell
cd ~
git lfs install
git clone https://github.com/patrick-dowell/GoForKids.git
```

If the repo is private, a GitHub sign-in window pops up — use the account that was given access.

The AI's ~270 MB neural-net file comes down via Git LFS. Verify it arrived:

```powershell
(Get-Item "$HOME\GoForKids\backend\models\b28.bin.gz").Length / 1MB
```

Should print roughly 270. If it's tiny, run `git lfs pull` from inside `$HOME\GoForKids`.

## 4. Point the app at KataGo

These settings save permanently — run once, then **close the window** (they only apply to newly opened windows):

```powershell
setx KATAGO_PATH "C:\katago\katago.exe"
setx KATAGO_MODEL "$HOME\GoForKids\backend\models\b28.bin.gz"
setx KATAGO_CONFIG "$HOME\GoForKids\backend\configs\analysis_example.cfg"
setx CALIBRATION_PROFILE_PATH "$HOME\GoForKids\data\profiles\b28.yaml"
setx STRICT_KATAGO 1
```

(`STRICT_KATAGO` makes a misconfiguration fail with a clear error instead of silently falling back to a dumb built-in AI.)

## 5. Tune KataGo (one time)

The first time KataGo runs on a machine, it spends several minutes tuning itself to your graphics card. Do that now, where you can watch the progress — otherwise it happens invisibly during your first game and looks like the bot froze:

```powershell
C:\katago\katago.exe benchmark -model "$HOME\GoForKids\backend\models\b28.bin.gz"
```

Let it run to completion. The result is cached, so this is a one-time wait.

## 6. Start the backend

In a new PowerShell window:

```powershell
cd $HOME\GoForKids\backend
python -m venv venv              # first time only
.\venv\Scripts\activate
pip install -r requirements.txt  # first time only
python -m uvicorn app.main:app --port 8000
```

Leave the window open — it *is* the server. http://localhost:8000/health should show a short line of text.

## 7. Start the frontend

In a second PowerShell window:

```powershell
cd $HOME\GoForKids\frontend
npm install    # first time only
npm run dev
```

Play at **http://localhost:5173**.

## Starting it again later

**Window 1:**
```powershell
cd $HOME\GoForKids\backend
.\venv\Scripts\activate
python -m uvicorn app.main:app --port 8000
```

**Window 2:**
```powershell
cd $HOME\GoForKids\frontend
npm run dev
```

Close both windows to stop.

## Troubleshooting

- **Backend exits with a KataGo error** — a step 4 setting is wrong, or your window was opened before you ran them. In a new window, `echo $env:KATAGO_PATH $env:KATAGO_MODEL $env:KATAGO_CONFIG $env:CALIBRATION_PROFILE_PATH` — each should be a path that exists. Fix with `setx`, then open a fresh window.
- **"model file is implausibly small"** — Git LFS didn't finish; run `git lfs pull` inside `$HOME\GoForKids` (step 3).
- **`VCRUNTIME140.dll` not found** — install https://aka.ms/vs/17/release/vc_redist.x64.exe and retry.
- **KataGo crashes with the OpenCL version** — your graphics drivers don't support it; replace `C:\katago` with the `eigenavx2-windows-x64.zip` release.
- **"running scripts is disabled on this system"** — run the `Set-ExecutionPolicy` line from step 1.
- **"address already in use"** — a previous copy is still running; close all PowerShell windows and start again.
- **The AI moves instantly and plays terribly** — KataGo never started (stub fallback). Check `STRICT_KATAGO` is `1` (step 4) and read the backend window's output.
