[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$credentialTarget = "interview-online/metrika-dashboard"
$dashboardPort = 4175
$repositoryRoot = Split-Path -Parent $PSScriptRoot

Add-Type -AssemblyName System.Windows.Forms

if (-not ("MetrikaDashboardCredential" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class MetrikaDashboardCredential
{
    private const int CRED_TYPE_GENERIC = 1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPointer);

    [DllImport("Advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr credentialPointer);

    public static string ReadGeneric(string target)
    {
        IntPtr credentialPointer;
        if (!CredRead(target, CRED_TYPE_GENERIC, 0, out credentialPointer))
        {
            return null;
        }

        try
        {
            var credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPointer, typeof(CREDENTIAL));
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
            {
                return null;
            }

            return Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
        }
        finally
        {
            CredFree(credentialPointer);
        }
    }
}
"@
}

function Show-Message([string]$message, [string]$title, [System.Windows.Forms.MessageBoxIcon]$icon) {
  [void][System.Windows.Forms.MessageBox]::Show($message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
}

try {
  $token = [MetrikaDashboardCredential]::ReadGeneric($credentialTarget)
  if ([string]::IsNullOrWhiteSpace($token)) {
    Show-Message "The local Metrika access token is missing. Ask Codex to update it; do not add it to HTML or this file." "Metrika dashboard" ([System.Windows.Forms.MessageBoxIcon]::Warning)
    exit 1
  }

  $node = Get-Command node.exe -ErrorAction Stop
  $listener = Get-NetTCPConnection -LocalPort $dashboardPort -State Listen -ErrorAction SilentlyContinue
  if (-not $listener) {
    $env:METRIKA_OAUTH_TOKEN = $token
    $env:METRIKA_DASHBOARD_PORT = "$dashboardPort"
    [void](Start-Process -FilePath $node.Source -ArgumentList ".\\scripts\\serve-metrika-dashboard.mjs" -WorkingDirectory $repositoryRoot -WindowStyle Hidden -PassThru)
  }

  $dashboardUrl = "http://127.0.0.1:$dashboardPort/"
  $available = $false
  foreach ($attempt in 1..40) {
    try {
      Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
      $available = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  if (-not $available) {
    throw "The local dashboard server did not respond."
  }

  Start-Process $dashboardUrl
} catch {
  Write-Error "Unable to open the local dashboard: $($_.Exception.Message)"
  Show-Message "Unable to open the dashboard. Make sure Node.js is installed, then try again." "Metrika dashboard" ([System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
} finally {
  Remove-Item Env:METRIKA_OAUTH_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:METRIKA_DASHBOARD_PORT -ErrorAction SilentlyContinue
  Remove-Variable token -ErrorAction SilentlyContinue
}
