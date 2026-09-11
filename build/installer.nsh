!macro customUnInstall
  File /oname=$PLUGINSDIR\navoke-uninstall-agent-setup.ps1 "${BUILD_RESOURCES_DIR}\uninstall-agent-setup.ps1"
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\navoke-uninstall-agent-setup.ps1"'
!macroend
