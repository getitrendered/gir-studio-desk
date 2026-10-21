param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function XmlPart($zip, $name) {
  $entry = $zip.GetEntry($name)
  if (!$entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { $doc = New-Object System.Xml.XmlDocument; $doc.LoadXml($reader.ReadToEnd()); return $doc } finally { $reader.Dispose() }
}
function Nodes($node, $query) { return @($node.SelectNodes($query)) }
function Attr($node, $name) { if (!$node) { return '' }; return [string]$node.GetAttribute($name) }
function ColIndex($reference) {
  $letters = ([regex]::Match($reference, '^[A-Z]+')).Value
  $number = 0
  foreach ($char in $letters.ToCharArray()) { $number = $number * 26 + ([int][char]$char - 64) }
  return $number
}
function TextCell($cell, $strings) {
  if (!$cell) { return '' }
  $type = Attr $cell 't'
  $v = $cell.SelectSingleNode("*[local-name()='v']")
  if ($type -eq 'inlineStr') { return [string]($cell.SelectSingleNode("*[local-name()='is']").InnerText) }
  if (!$v) { return '' }
  if ($type -eq 's') { $i = [int]$v.InnerText; if ($i -lt $strings.Count) { return [string]$strings[$i] } }
  return [string]$v.InnerText
}
function ExcelDate($raw, $date1904) {
  if (!$raw) { return '' }
  $number = 0.0
  if ([double]::TryParse($raw, [ref]$number) -and $number -gt 1000 -and $number -lt 100000) {
    $base = if ($date1904) { [datetime]'1904-01-01' } else { [datetime]'1899-12-30' }
    return $base.AddDays($number).ToString('yyyy-MM-dd')
  }
  $date = [datetime]::MinValue
  if ([datetime]::TryParse($raw, [ref]$date)) { return $date.ToString('yyyy-MM-dd') }
  return $raw
}
function Yellow($cell, $fillIds, $fills) {
  if (!$cell) { return $false }
  $s = Attr $cell 's'; $style = if ($s) { [int]$s } else { 0 }
  if ($style -ge $fillIds.Count) { return $false }
  $fill = $fills[$fillIds[$style]]
  if (!$fill) { return $false }
  $fg = $fill.SelectSingleNode("*[local-name()='patternFill']/*[local-name()='fgColor']")
  if (!$fg) { return $false }
  $rgb = Attr $fg 'rgb'
  if ($rgb) {
    $rgb = $rgb.Substring([Math]::Max(0, $rgb.Length - 6))
    $r = [Convert]::ToInt32($rgb.Substring(0,2),16); $g = [Convert]::ToInt32($rgb.Substring(2,2),16); $b = [Convert]::ToInt32($rgb.Substring(4,2),16)
    return ($r -ge 180 -and $g -ge 150 -and $b -le 225 -and ($g - $b) -ge 20 -and ($r - $b) -ge 30)
  }
  return ((Attr $fg 'indexed') -in @('5','6','13','19'))
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
try {
  $workbook = XmlPart $zip 'xl/workbook.xml'
  if (!$workbook) { throw 'Not a valid .xlsx workbook' }
  $relations = XmlPart $zip 'xl/_rels/workbook.xml.rels'
  $styles = XmlPart $zip 'xl/styles.xml'
  $shared = XmlPart $zip 'xl/sharedStrings.xml'
  $strings = @()
  if ($shared) { $strings = @(Nodes $shared "//*[local-name()='si']" | ForEach-Object { $_.InnerText }) }
  $fills = @(); $fillIds = @(0)
  if ($styles) {
    $fills = @(Nodes $styles "//*[local-name()='fills']/*[local-name()='fill']")
    $fillIds = @(Nodes $styles "//*[local-name()='cellXfs']/*[local-name()='xf']" | ForEach-Object { [int](Attr $_ 'fillId') })
  }
  $relMap = @{}
  foreach ($rel in (Nodes $relations "//*[local-name()='Relationship']")) { $relMap[(Attr $rel 'Id')] = (Attr $rel 'Target') }
  $date1904 = (Attr ($workbook.SelectSingleNode("//*[local-name()='workbookPr']")) 'date1904') -in @('1','true')
  $result = @(); $skipped = @()
  foreach ($sheet in (Nodes $workbook "//*[local-name()='sheets']/*[local-name()='sheet']")) {
    $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = $relMap[$rid]
    if (!$target) { continue }
    $target = $target.Replace('\','/').TrimStart('/')
    if (!$target.StartsWith('xl/')) { $target = 'xl/' + $target }
    $xml = XmlPart $zip $target
    if (!$xml) { continue }
    $rawRows = @()
    foreach ($row in (Nodes $xml "//*[local-name()='sheetData']/*[local-name()='row']")) {
      $cells = @{}
      foreach ($c in (Nodes $row "*[local-name()='c']")) { $cells[(ColIndex (Attr $c 'r'))] = $c }
      $rawRows += [pscustomobject]@{ index = [int](Attr $row 'r'); cells = $cells }
    }
    $headers = @{}; $headerRow = 0
    foreach ($row in $rawRows) {
      $found = @{}
      foreach ($key in $row.cells.Keys) {
        $h = (TextCell $row.cells[$key] $strings).Trim().ToLower() -replace '[^a-z0-9]',''
        if ($h -match '^sr(no|number)$|^serial(no|number)$') { $found.serial = $key }
        elseif ($h -eq 'date') { $found.date = $key }
        elseif ($h -match '^serviceprovided$|^service$|^description$') { $found.service = $key }
        elseif ($h -match '^quantity$|^qty$') { $found.quantity = $key }
        elseif ($h -eq 'rate') { $found.rate = $key }
        elseif ($h -eq 'total') { $found.total = $key }
        elseif ($h -eq 'status') { $found.status = $key }
        elseif ($h -match '^remarks?$|^notes?$') { $found.remarks = $key }
        elseif ($h -match '^advance(s|taken|received|amount)?$') { $found.advance = $key }
      }
      if ($found.ContainsKey('service') -and $found.ContainsKey('date') -and $found.ContainsKey('status')) { $headers = $found; $headerRow = $row.index; break }
    }
    if (!$headerRow) { $skipped += [pscustomobject]@{ name = (Attr $sheet 'name'); reason = 'Required Date, Service and Status headers were not found' }; continue }
    $items = @(); $groupNo = 0; $previousYellow = $false
    $advanceColumn = if ($headers.ContainsKey('advance')) { [int]$headers.advance } else { 12 }
    foreach ($row in ($rawRows | Where-Object { $_.index -gt $headerRow })) {
      $read = { param($name) if ($headers.ContainsKey($name)) { TextCell $row.cells[$headers[$name]] $strings } else { '' } }
      $service = (& $read 'service').Trim()
      if (!$service) { $previousYellow = $false; continue }
      $count = 0; $yellowCount = 0
      foreach ($name in @('serial','date','service','quantity','rate','total','status','remarks')) {
        if ($headers.ContainsKey($name)) { $count++; if (Yellow $row.cells[$headers[$name]] $fillIds $fills) { $yellowCount++ } }
      }
      $isYellow = $yellowCount -ge [Math]::Max(2,[Math]::Ceiling($count * 0.5))
      if ($isYellow -and !$previousYellow) { $groupNo++ }
      $previousYellow = $isYellow
      $status = (& $read 'status').Trim().ToLower()
      $total = (& $read 'total').Trim()
      $advance = (TextCell $row.cells[$advanceColumn] $strings).Trim()
      if ($status -match '^[\-–—]$') { $status = 'discarded' }
      elseif ($status -notin @('paid','sent','pending','working')) { $status = 'pending' }
      $items += [pscustomobject]@{
        sourceRow = $row.index; serial = (& $read 'serial'); date = (ExcelDate (& $read 'date') $date1904)
        service = $service; quantity = (& $read 'quantity'); rate = (& $read 'rate'); total = $total
        status = $status; remarks = (& $read 'remarks'); advance = $advance
        advanceCell = $(if ($advance) { Attr $row.cells[$advanceColumn] 'r' } else { '' })
        yellowGroup = $(if ($isYellow) { $groupNo } else { $null })
      }
    }
    $groups = @()
    $lastTableColumn = [int](($headers.GetEnumerator() | Where-Object { $_.Key -ne 'advance' } | ForEach-Object { $_.Value } | Measure-Object -Maximum).Maximum)
    $groupNumbers = @($items | Where-Object { $null -ne $_.yellowGroup } | ForEach-Object { $_.yellowGroup } | Sort-Object -Unique)
    foreach ($number in $groupNumbers) {
      $sourceRows = @($items | Where-Object { $_.yellowGroup -eq $number } | ForEach-Object { $_.sourceRow })
      $startRow = [int](($sourceRows | Measure-Object -Minimum).Minimum)
      $endRow = [int](($sourceRows | Measure-Object -Maximum).Maximum)
      $markers = @()
      foreach ($row in ($rawRows | Where-Object { $_.index -ge $startRow -and $_.index -le $endRow })) {
        foreach ($column in $row.cells.Keys) {
          if ([int]$column -le $lastTableColumn) { continue }
          $value = (TextCell $row.cells[$column] $strings).Trim()
          if ($value -match '(?i)closed\s*at') { $markers += [pscustomobject]@{ column = [int]$column; row = $row.index } }
        }
      }
      $amount = $null; $amountCell = ''; $warning = ''
      if ($markers.Count -gt 0) {
        $marker = $markers | Sort-Object row,column | Select-Object -First 1
        $values = @()
        foreach ($row in ($rawRows | Where-Object { $_.index -ge $startRow -and $_.index -le $endRow })) {
          foreach ($column in $row.cells.Keys) {
            if ([int]$column -ne $marker.column) { continue }
            $raw = (TextCell $row.cells[$column] $strings).Trim() -replace '[\u20B9,]','' -replace '^(?i:rs\.?\s*)',''
            if ($raw -match '^\d+(?:\.\d{1,2})?$') {
              $values += [pscustomobject]@{ value = [decimal]::Parse($raw, [cultureinfo]::InvariantCulture); cell = (Attr $row.cells[$column] 'r') }
            }
          }
        }
        if ($values.Count -eq 0 -and ($marker.column + 1) -ne $advanceColumn) {
          foreach ($row in ($rawRows | Where-Object { $_.index -ge $startRow -and $_.index -le $endRow })) {
            $column = $marker.column + 1
            if (!$row.cells.ContainsKey($column)) { continue }
            $raw = (TextCell $row.cells[$column] $strings).Trim() -replace '[\u20B9,]','' -replace '^(?i:rs\.?\s*)',''
            if ($raw -match '^\d+(?:\.\d{1,2})?$') {
              $values += [pscustomobject]@{ value = [decimal]::Parse($raw, [cultureinfo]::InvariantCulture); cell = (Attr $row.cells[$column] 'r') }
            }
          }
        }
        if ($values.Count -eq 1) { $amount = $values[0].value; $amountCell = $values[0].cell }
        elseif ($values.Count -gt 1) { $warning = 'More than one amount was found beside closed at; enter the correct amount in the preview' }
        else { $warning = 'Closed at label found, but its amount was not found' }
      } else {
        $candidates = @()
        foreach ($row in ($rawRows | Where-Object { $_.index -ge $startRow -and $_.index -le $endRow })) {
          foreach ($column in $row.cells.Keys) {
            if ([int]$column -le $lastTableColumn -or [int]$column -eq $advanceColumn) { continue }
            $raw = (TextCell $row.cells[$column] $strings).Trim() -replace '[\u20B9,]','' -replace '^(?i:rs\.?\s*)',''
            if ($raw -match '^\d+(?:\.\d{1,2})?$') {
              $candidates += [pscustomobject]@{ value = [decimal]::Parse($raw, [cultureinfo]::InvariantCulture); cell = (Attr $row.cells[$column] 'r') }
            }
          }
        }
        if ($candidates.Count -eq 1) { $amount = $candidates[0].value; $amountCell = $candidates[0].cell }
        elseif ($candidates.Count -gt 1) { $warning = 'Multiple amounts found beside this yellow group; choose the closed amount in the preview' }
        else { $warning = 'Yellow group has no detected closed amount; check the preview' }
      }
      $groups += [pscustomobject]@{ sourceGroup = $number; startRow = $startRow; endRow = $endRow; agreedAmount = $amount; amountCell = $amountCell; warning = $warning }
    }
    $result += [pscustomobject]@{ name = (Attr $sheet 'name'); items = @($items); groups = @($groups); headerRow = $headerRow }
  }
  @{ fileName = [System.IO.Path]::GetFileName($Path); clients = @($result); skippedSheets = @($skipped) } | ConvertTo-Json -Depth 9 -Compress
} finally { $zip.Dispose() }
