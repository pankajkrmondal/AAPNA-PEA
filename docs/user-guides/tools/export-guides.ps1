<#
  Builds the shareable copies of the PEA user guides.

    <guide>.md  --pandoc-->                     exports\<name>.docx
    <guide>.md  --pandoc--> HTML --Edge-->      exports\<name>.pdf

  The ATS user guides' mechanism (.md -> pandoc -> .docx, then a PDF), with
  two changes: pandoc is given a Word template whose tables have borders and a
  shaded header row (its own default has none), and the PDF is printed by
  Microsoft Edge rather than Word (see step 2).

  Needs: pandoc (2.x or later) on PATH, and Microsoft Edge. Word is not needed.

  Usage, from the PEA-Local folder:
    powershell -ExecutionPolicy Bypass -File "docs\user-guides\tools\export-guides.ps1"
    ... -File export-guides.ps1 -Only 01-HR-GUIDE.md      # one guide
#>
param(
  [string[]]$Only
)

$ErrorActionPreference = 'Stop'

$tools   = $PSScriptRoot
$guides  = Split-Path $tools -Parent
$exports = Join-Path $guides 'exports'
$filter  = Join-Path $tools 'strip-md-links.lua'

# Source file -> exported name. README is the overview, so it is named as one.
$docs = [ordered]@{
  'README.md'                    = '00-PEA-OVERVIEW'
  '01-HR-GUIDE.md'               = '01-HR-GUIDE'
  '02-ADMIN-GUIDE.md'            = '02-ADMIN-GUIDE'
  '03-SUPERADMIN-GUIDE.md'       = '03-SUPERADMIN-GUIDE'
  '04-MANAGERS-AND-COMMANDOS.md' = '04-MANAGERS-AND-COMMANDOS'
}

if (-not (Get-Command pandoc -ErrorAction SilentlyContinue)) { throw 'pandoc is not on PATH.' }
New-Item -ItemType Directory -Force $exports | Out-Null

$selected = $docs.Keys | Where-Object { -not $Only -or $Only -contains $_ }
if (-not $selected) { throw "Nothing to export. Choose from: $($docs.Keys -join ', ')" }

# â”€â”€ 0. The Word template: pandoc's default, with bordered tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Made fresh on each run from the pandoc that is installed, so there is no
# binary template to keep in step with it.
$reference = Join-Path ([IO.Path]::GetTempPath()) 'pea-guides-reference.docx'
& cmd /c "pandoc -o `"$reference`" --print-default-data-file reference.docx"
if ($LASTEXITCODE -ne 0) { throw 'pandoc could not write its default reference.docx' }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($reference, 'Update')
try {
  $entry = $zip.GetEntry('word/styles.xml')
  $reader = New-Object IO.StreamReader($entry.Open())
  $xml = $reader.ReadToEnd()
  $reader.Close()

  $start = $xml.IndexOf('w:styleId="Table"')
  $end = $xml.IndexOf('</w:style>', $start)
  if ($start -lt 0 -or $end -lt 0) { throw 'The Table style was not found in reference.docx' }
  $style = $xml.Substring($start, $end - $start)

  $line = 'w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"'
  $borders = "<w:tblBorders><w:top $line/><w:left $line/><w:bottom $line/><w:right $line/>" +
             "<w:insideH $line/><w:insideV $line/></w:tblBorders>"
  $new = $style `
    -replace '(<w:tblInd w:w="0" w:type="dxa" />\s*)(<w:tblCellMar>)', "`$1$borders`$2" `
    -replace '<w:top w:w="0" w:type="dxa" />', '<w:top w:w="40" w:type="dxa" />' `
    -replace '<w:bottom w:w="0" w:type="dxa" />', '<w:bottom w:w="40" w:type="dxa" />' `
    -replace '(<w:tblStylePr w:type="firstRow">)', '$1<w:rPr><w:b /></w:rPr>' `
    -replace '(</w:tcBorders>)', '$1<w:shd w:val="clear" w:color="auto" w:fill="E7EEE0" />'
  if ($new -eq $style -or $new -notmatch 'tblBorders') { throw 'Could not add borders to the Table style' }
  $xml = $xml.Substring(0, $start) + $new + $xml.Substring($end)

  $entry.Delete()
  $writer = New-Object IO.StreamWriter($zip.CreateEntry('word/styles.xml').Open(), (New-Object Text.UTF8Encoding($false)))
  $writer.Write($xml)
  $writer.Close()
} finally {
  $zip.Dispose()
}

# â”€â”€ 1. Markdown -> Word, with pandoc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# gfm_auto_identifiers: heading ids as GitHub makes them ("#1-signing-inâ€¦"),
# so the Contents links inside each guide keep working in Word and PDF.
# --shift-heading-level-by=-1: the guide's "# â€¦" heading becomes the document
# title and its "## â€¦" sections Word's Heading 1. Pictures wider than the page
# are scaled to fit by pandoc.
foreach ($md in $selected) {
  $name = $docs[$md]
  $docx = Join-Path $exports "$name.docx"
  Write-Host "pandoc  $md -> exports\$name.docx"
  & pandoc (Join-Path $guides $md) `
    --from markdown+gfm_auto_identifiers+lists_without_preceding_blankline+pipe_tables+task_lists `
    --to docx `
    --reference-doc $reference `
    --resource-path $guides `
    --lua-filter $filter `
    --shift-heading-level-by=-1 `
    --output $docx
  if ($LASTEXITCODE -ne 0) { throw "pandoc failed on $md" }
}

# â”€â”€ 2. Markdown -> PDF, with pandoc and Microsoft Edge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# pandoc writes one self-contained HTML page per guide (pictures and
# guide-print.css inside it), and Edge, headless, prints it to PDF.
#
# Not Word, as the ATS guides did: Word driven from a script stopped, again and
# again, on a prompt it never shows (28-10-2026), and the export hung. Edge has
# no prompts to wait on.
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found.' }

$work = Join-Path ([IO.Path]::GetTempPath()) ("pea-guides-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null
try {
  foreach ($md in $selected) {
    $name = $docs[$md]
    $html = Join-Path $work "$name.html"
    $pdf  = Join-Path $exports "$name.pdf"
    Write-Host "edge    $md -> exports\$name.pdf"
    & pandoc (Join-Path $guides $md) `
      --from markdown+gfm_auto_identifiers+lists_without_preceding_blankline+pipe_tables+task_lists `
      --to html5 --standalone --self-contained `
      --css (Join-Path $tools 'guide-print.css') `
      --resource-path $guides `
      --lua-filter $filter `
      --shift-heading-level-by=-1 `
      --output $html
    if ($LASTEXITCODE -ne 0) { throw "pandoc (HTML) failed on $md" }

    # Its own profile folder, so an Edge you have open is not disturbed.
    $edgeArgs = @(
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer',
      "--user-data-dir=`"$work\edge`"", "--print-to-pdf=`"$pdf`"",
      ('file:///' + ($html -replace '\\', '/'))
    )
    $p = Start-Process $edge -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden
    if (-not $p.WaitForExit(60000)) { $p.Kill(); throw "Edge did not finish printing $name" }
    if (-not (Test-Path $pdf)) { throw "Edge did not write $name.pdf" }
  }
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $reference -ErrorAction SilentlyContinue
}
Write-Host "Done. Files are in $exports"
