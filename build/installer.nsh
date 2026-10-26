!macro customInit
  ; If legacy GIR Studio Desk is installed, uninstall it silently
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.gir.studiodesk" "UninstallString"
  ${If} $R0 != ""
    ExecWait '$R0 /S _?=$LOCALAPPDATA\Programs\gir-studio-desk'
  ${EndIf}
!macroend

!macro customInstall
  ; Enable Windows notification banners and sound for MeowSheet
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.meowsheet.app" "ShowBanner" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.meowsheet.app" "Enabled" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.meowsheet.app" "ShowInActionCenter" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.meowsheet.app" "Sound" 1
!macroend
