!macro customInit
  ; If legacy GIR Studio Desk is installed, uninstall it silently
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.gir.studiodesk" "UninstallString"
  ${If} $R0 != ""
    ExecWait '$R0 /S _?=$LOCALAPPDATA\Programs\gir-studio-desk'
  ${EndIf}
!macroend
