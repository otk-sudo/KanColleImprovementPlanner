# 開発環境

- 作業場所：C:\dev\KanColleImprovementPlanner
- PowerShell、git、node、npm、claude.cmdが現在のPCのPATHに存在することを確認。
- 公開先はGitHub Pages。技術推奨案はdocs/technology-selection.md。正確な依存版と互換性は未検証。
- アプリ雛形、package.json、依存インストール、ビルド、テスト、デプロイは未実施。
- Gitはローカル初期化。remoteとGitHub保護/CIは未設定。
- Claude設定はルートCLAUDE.mdがAGENTS.mdを参照。.claude/settings.jsonは空のプロジェクト設定とし、既存の個人設定を上書きしない。
- CreationLogのJAVA_HOME/ANDROID_HOMEやAndroidコードはコピーしない。
- 起動：Set-Location C:\dev\KanColleImprovementPlanner の後に claude.cmd。
- docs/claude-start-prompt.txtを初回依頼に使用。Claude自体は今回自動起動していない。
- 個人の所持入力はprivate/に置きGit除外。アプリ配布物にも含めない。
