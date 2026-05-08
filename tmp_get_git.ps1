# PowerShell script to collect git evidence for task card audit
$cards = @(
    "ATM-2-0009",
    "UI-2-0083",
    "ATM-2-0014",
    "ATM-2-0019",
    "ATM-2-0025"
)

foreach ($card in $cards) {
    $file = "docs/agent-briefs/tasks/$card.md"
    $outFile = "tmp_git_${card}.txt"
    
    # Get full git log with follow
    $log = & git log --follow --pretty=format:"%h|%cI|%s" -- $file 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $log) {
        "NO_LOG|$card" | Set-Content $outFile -Encoding UTF8
        continue
    }
    $log | Set-Content $outFile -Encoding UTF8
    
    # Also get detailed patch info for first and last commit
    $commits = ($log -split "`r?`n")
    if ($commits.Count -gt 0) {
        $firstCommit = ($commits[-1] -split "\|")[0]
        $lastCommit = ($commits[0] -split "\|")[0]
        
        $detailFile = "tmp_git_detail_${card}.txt"
        $detail = & git show --stat $firstCommit -- $file 2>$null
        "=== FIRST COMMIT $firstCommit ===" | Set-Content $detailFile -Encoding UTF8
        $detail | Add-Content $detailFile -Encoding UTF8
        
        $detail2 = & git show --stat $lastCommit -- $file 2>$null
        "`n=== LAST COMMIT $lastCommit ===" | Add-Content $detailFile -Encoding UTF8
        $detail2 | Add-Content $detailFile -Encoding UTF8
    }
}

"DONE" | Set-Content "tmp_git_done.txt" -Encoding UTF8
