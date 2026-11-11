from pathlib import Path
import sys

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from golden_from_xlsx import convert


def test_convert_alina_layout(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Question ID", "Question", "Expected Answer", "Expected Source (Document / Page / Section)", "Expected Citation", "Comment"])
    ws.append(["GS-001", "Can a framework contract exceed four years?", "Only in duly justified cases.",
               "Financial Regulation (2024).pdf, Annex I point 1.3; Vademecum section 2.7", "Annex I point 1.3", "ok"])
    ws.append([None, None, None, None, None, None])
    ws.append(["GS-002", "What is a DPS?", "A dynamic purchasing system is ...", None, "Annex I point 1.4", None])
    p = tmp_path / "g.xlsx"
    wb.save(p)
    data = convert(p)
    q = data["questions"]
    assert [x["id"] for x in q] == ["GS-001", "GS-002"]
    assert q[0]["expected_sources"] == ["Financial Regulation (2024).pdf, Annex I point 1.3", "Vademecum section 2.7"]
    assert q[0]["notes"] == "ok" and q[0]["expected_answer"] == "Only in duly justified cases."
    assert q[1]["expected_sources"] == ["Annex I point 1.4"], "citation used when no source column value"
