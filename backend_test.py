#!/usr/bin/env python3
"""
ShiftOps Backend Regression Test Suite
Tests the 4 bug fixes reported by user
"""

import requests
import json
from datetime import datetime, timedelta

# Base URL from .env
BASE_URL = "https://ops-dashboard-245.preview.emergentagent.com/api"

# Test credentials
SUPERVISOR_EMAIL = "admin@shiftops.io"
SUPERVISOR_PASSWORD = "admin123"

# Global state
supervisor_token = None
employee_token = None
test_employee = None
area1_id = None
area2_id = None
settings = None

def log(msg):
    print(f"[TEST] {msg}")

def log_pass(msg):
    print(f"✅ PASS: {msg}")

def log_fail(msg):
    print(f"❌ FAIL: {msg}")

def get_today():
    return datetime.now().strftime("%Y-%m-%d")

# ============================================================================
# Test 1: POST /api/employees/{id}/reset-password
# ============================================================================
def test_reset_password():
    global supervisor_token, test_employee, employee_token
    
    log("\n" + "="*80)
    log("TEST 1: POST /api/employees/{id}/reset-password")
    log("="*80)
    
    try:
        # Login as supervisor
        log("Step 1.1: Login as supervisor")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": SUPERVISOR_EMAIL,
            "password": SUPERVISOR_PASSWORD
        })
        if resp.status_code != 200:
            log_fail(f"Supervisor login failed: {resp.status_code} {resp.text}")
            return False
        supervisor_token = resp.json()["token"]
        log_pass(f"Supervisor logged in, token: {supervisor_token[:20]}...")
        
        # Get employees
        log("Step 1.2: GET /api/employees")
        resp = requests.get(f"{BASE_URL}/employees", headers={
            "Authorization": f"Bearer {supervisor_token}"
        })
        if resp.status_code != 200:
            log_fail(f"Get employees failed: {resp.status_code} {resp.text}")
            return False
        employees = resp.json()["employees"]
        if len(employees) == 0:
            log_fail("No employees found")
            return False
        test_employee = employees[0]
        log_pass(f"Found {len(employees)} employees, using: {test_employee['name']} ({test_employee['email']})")
        
        # Reset password
        log("Step 1.3: POST /api/employees/{id}/reset-password")
        new_password = "newpass123"
        resp = requests.post(f"{BASE_URL}/employees/{test_employee['id']}/reset-password", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={"newPassword": new_password}
        )
        if resp.status_code != 200:
            log_fail(f"Reset password failed: {resp.status_code} {resp.text}")
            if "Name, email, password required" in resp.text:
                log_fail("BUG DETECTED: Got 'Name, email, password required' error - route conflict!")
            return False
        result = resp.json()
        if result.get("ok") != True:
            log_fail(f"Reset password returned unexpected response: {result}")
            return False
        log_pass(f"Reset password successful: {result}")
        
        # Login with new password
        log("Step 1.4: Login employee with new password")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": test_employee["email"],
            "password": new_password
        })
        if resp.status_code != 200:
            log_fail(f"Employee login with new password failed: {resp.status_code} {resp.text}")
            return False
        employee_token = resp.json()["token"]
        log_pass(f"Employee logged in with new password, token: {employee_token[:20]}...")
        
        # Test with optional requestId
        log("Step 1.5: Reset password with optional requestId")
        resp = requests.post(f"{BASE_URL}/employees/{test_employee['id']}/reset-password", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={"newPassword": "pass1234", "requestId": "nonexistent"}
        )
        if resp.status_code != 200:
            log_fail(f"Reset password with requestId failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Reset password with optional requestId works")
        
        # Reset back to original password
        log("Step 1.6: Reset back to original password")
        resp = requests.post(f"{BASE_URL}/employees/{test_employee['id']}/reset-password", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={"newPassword": "emp123"}
        )
        if resp.status_code != 200:
            log_fail(f"Reset back to original failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Reset back to emp123 successful")
        
        # Re-login with original password
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": test_employee["email"],
            "password": "emp123"
        })
        if resp.status_code != 200:
            log_fail(f"Employee login with original password failed: {resp.status_code} {resp.text}")
            return False
        employee_token = resp.json()["token"]
        log_pass("Employee re-logged in with emp123")
        
        log_pass("TEST 1 PASSED: Reset password endpoint works correctly")
        return True
        
    except Exception as e:
        log_fail(f"TEST 1 EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

# ============================================================================
# Test 2: Break lifecycle - no re-request after completion
# ============================================================================
def test_break_lifecycle():
    global supervisor_token, employee_token, test_employee, area1_id, area2_id, settings
    
    log("\n" + "="*80)
    log("TEST 2: Break lifecycle - no re-request after completion")
    log("="*80)
    
    try:
        # Create a fresh employee for this test to ensure clean state
        log("Step 2.0: Create fresh employee for testing")
        import random
        random_id = random.randint(1000, 9999)
        fresh_emp_email = f"testbreaks{random_id}@shiftops.io"
        resp = requests.post(f"{BASE_URL}/employees", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={
                "name": f"Test Employee {random_id}",
                "email": fresh_emp_email,
                "password": "emp123",
                "phone": "+1 555 9999",
                "department": "Testing",
                "employeeRole": "Test Agent"
            }
        )
        if resp.status_code != 200:
            log_fail(f"Create employee failed: {resp.status_code} {resp.text}")
            return False
        fresh_emp_id = resp.json()["id"]
        log_pass(f"Created fresh employee: {fresh_emp_email} (ID: {fresh_emp_id})")
        
        # Login as the fresh employee
        log("Step 2.0b: Login as fresh employee")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": fresh_emp_email,
            "password": "emp123"
        })
        if resp.status_code != 200:
            log_fail(f"Fresh employee login failed: {resp.status_code} {resp.text}")
            return False
        employee_token = resp.json()["token"]
        log_pass(f"Fresh employee logged in")
        
        # Update test_employee to use the fresh one
        test_employee = {"id": fresh_emp_id, "email": fresh_emp_email, "name": f"Test Employee {random_id}"}
        
        # Get settings
        log("Step 2.1: GET /api/settings")
        resp = requests.get(f"{BASE_URL}/settings", headers={
            "Authorization": f"Bearer {supervisor_token}"
        })
        if resp.status_code != 200:
            log_fail(f"Get settings failed: {resp.status_code} {resp.text}")
            return False
        settings = resp.json()["settings"]
        area1_id = settings["currentAreaId"]
        log_pass(f"Current area: {area1_id}")
        
        # Get areas
        log("Step 2.2: GET /api/areas")
        resp = requests.get(f"{BASE_URL}/areas", headers={
            "Authorization": f"Bearer {supervisor_token}"
        })
        if resp.status_code != 200:
            log_fail(f"Get areas failed: {resp.status_code} {resp.text}")
            return False
        areas = resp.json()["areas"]
        log_pass(f"Found {len(areas)} areas")
        
        # Create second area if needed
        if len(areas) < 2:
            log("Step 2.3: Creating second area 'Check-in'")
            resp = requests.post(f"{BASE_URL}/areas", 
                headers={"Authorization": f"Bearer {supervisor_token}"},
                json={"name": "Check-in"}
            )
            if resp.status_code != 200:
                log_fail(f"Create area failed: {resp.status_code} {resp.text}")
                return False
            area2_id = resp.json()["id"]
            log_pass(f"Created area2: {area2_id}")
        else:
            area2_id = areas[1]["id"]
            log_pass(f"Using existing area2: {area2_id}")
        
        # Enable both approvals
        log("Step 2.4: Enable both approvals")
        resp = requests.patch(f"{BASE_URL}/settings", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={
                "requireBreakStartApproval": True,
                "requireBreakReturnApproval": True
            }
        )
        if resp.status_code != 200:
            log_fail(f"Update settings failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Both approvals enabled")
        
        # Ensure employee is on today's roster in area1
        log("Step 2.6: Add employee to today's roster in area1")
        today = get_today()
        resp = requests.post(f"{BASE_URL}/rosters", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={
                "areaId": area1_id,
                "date": today,
                "employeeIds": [test_employee["id"]]
            }
        )
        if resp.status_code != 200:
            log_fail(f"Create roster failed: {resp.status_code} {resp.text}")
            return False
        log_pass(f"Employee added to roster for {today} in area1")
        
        # ========================================================================
        # Scenario A: Approval flow both ON
        # ========================================================================
        log("\n--- Scenario A: Approval flow both ON ---")
        
        # Request lunch
        log("Step A.1: Employee requests lunch")
        resp = requests.post(f"{BASE_URL}/breaks/request", 
            headers={"Authorization": f"Bearer {employee_token}"},
            json={"type": "lunch"}
        )
        if resp.status_code != 200:
            log_fail(f"Request lunch failed: {resp.status_code} {resp.text}")
            return False
        session_data = resp.json()
        session_id = session_data["id"]
        if session_data["status"] != "pending":
            log_fail(f"Expected status 'pending', got '{session_data['status']}'")
            return False
        log_pass(f"Lunch requested, session: {session_id}, status: pending")
        
        # Supervisor approves start
        log("Step A.2: Supervisor approves start")
        resp = requests.post(f"{BASE_URL}/breaks/{session_id}/approve", 
            headers={"Authorization": f"Bearer {supervisor_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Approve start failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Start approved")
        
        # Employee requests return
        log("Step A.3: Employee requests return")
        resp = requests.post(f"{BASE_URL}/breaks/return", 
            headers={"Authorization": f"Bearer {employee_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Request return failed: {resp.status_code} {resp.text}")
            return False
        return_data = resp.json()
        if return_data["status"] != "pending_return":
            log_fail(f"Expected status 'pending_return', got '{return_data['status']}'")
            return False
        log_pass("Return requested, status: pending_return")
        
        # Supervisor approves return
        log("Step A.4: Supervisor approves return")
        resp = requests.post(f"{BASE_URL}/breaks/{session_id}/approve", 
            headers={"Authorization": f"Bearer {supervisor_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Approve return failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Return approved")
        
        # Check employee status
        log("Step A.5: GET /api/my/status")
        resp = requests.get(f"{BASE_URL}/my/status", 
            headers={"Authorization": f"Bearer {employee_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Get my status failed: {resp.status_code} {resp.text}")
            return False
        status = resp.json()
        if status["currentStatus"] != "Working":
            log_fail(f"Expected currentStatus 'Working', got '{status['currentStatus']}'")
            return False
        if status["lunch"]["status"] != "Completed":
            log_fail(f"Expected lunch.status 'Completed', got '{status['lunch']['status']}'")
            return False
        if status["activeSession"] is not None:
            log_fail(f"Expected activeSession null, got {status['activeSession']}")
            return False
        log_pass(f"Status correct: currentStatus=Working, lunch.status=Completed, activeSession=null")
        
        # Try to request lunch again - should fail
        log("Step A.6: Try to request lunch again (should fail)")
        resp = requests.post(f"{BASE_URL}/breaks/request", 
            headers={"Authorization": f"Bearer {employee_token}"},
            json={"type": "lunch"}
        )
        if resp.status_code != 400:
            log_fail(f"Expected 400, got {resp.status_code}")
            return False
        error = resp.json()
        if "lunch already used" not in error.get("error", ""):
            log_fail(f"Expected 'lunch already used' error, got: {error}")
            return False
        log_pass("Correctly blocked re-request: 'lunch already used'")
        
        log_pass("SCENARIO A PASSED")
        
        # ========================================================================
        # Scenario B: Force End variant
        # ========================================================================
        log("\n--- Scenario B: Force End variant ---")
        
        # Request tea
        log("Step B.1: Employee requests tea")
        resp = requests.post(f"{BASE_URL}/breaks/request", 
            headers={"Authorization": f"Bearer {employee_token}"},
            json={"type": "tea"}
        )
        if resp.status_code != 200:
            log_fail(f"Request tea failed: {resp.status_code} {resp.text}")
            return False
        session_data = resp.json()
        session_id_tea = session_data["id"]
        log_pass(f"Tea requested, session: {session_id_tea}")
        
        # Supervisor approves start
        log("Step B.2: Supervisor approves start")
        resp = requests.post(f"{BASE_URL}/breaks/{session_id_tea}/approve", 
            headers={"Authorization": f"Bearer {supervisor_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Approve start failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Start approved")
        
        # Employee requests return
        log("Step B.3: Employee requests return")
        resp = requests.post(f"{BASE_URL}/breaks/return", 
            headers={"Authorization": f"Bearer {employee_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Request return failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Return requested")
        
        # Supervisor Force End instead of approve
        log("Step B.4: Supervisor Force End")
        resp = requests.post(f"{BASE_URL}/breaks/{session_id_tea}/end", 
            headers={"Authorization": f"Bearer {supervisor_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Force end failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Force end successful")
        
        # Check status
        log("Step B.5: GET /api/my/status")
        resp = requests.get(f"{BASE_URL}/my/status", 
            headers={"Authorization": f"Bearer {employee_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Get my status failed: {resp.status_code} {resp.text}")
            return False
        status = resp.json()
        if status["currentStatus"] != "Working":
            log_fail(f"Expected currentStatus 'Working', got '{status['currentStatus']}'")
            return False
        if status["tea"]["status"] != "Completed":
            log_fail(f"Expected tea.status 'Completed', got '{status['tea']['status']}'")
            return False
        log_pass("Status correct after Force End")
        
        # Try to request tea again - should fail
        log("Step B.6: Try to request tea again (should fail)")
        resp = requests.post(f"{BASE_URL}/breaks/request", 
            headers={"Authorization": f"Bearer {employee_token}"},
            json={"type": "tea"}
        )
        if resp.status_code != 400:
            log_fail(f"Expected 400, got {resp.status_code}")
            return False
        error = resp.json()
        if "tea already used" not in error.get("error", ""):
            log_fail(f"Expected 'tea already used' error, got: {error}")
            return False
        log_pass("Correctly blocked re-request after Force End")
        
        log_pass("SCENARIO B PASSED")
        
        # ========================================================================
        # Scenario C: Toggle approvals OFF after completion
        # ========================================================================
        log("\n--- Scenario C: Toggle approvals OFF after completion ---")
        
        log("Step C.1: Disable both approvals")
        resp = requests.patch(f"{BASE_URL}/settings", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={
                "requireBreakStartApproval": False,
                "requireBreakReturnApproval": False
            }
        )
        if resp.status_code != 200:
            log_fail(f"Update settings failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Both approvals disabled")
        
        # Try to request lunch again - should still fail
        log("Step C.2: Try to request lunch (should still fail)")
        resp = requests.post(f"{BASE_URL}/breaks/request", 
            headers={"Authorization": f"Bearer {employee_token}"},
            json={"type": "lunch"}
        )
        if resp.status_code != 400:
            log_fail(f"Expected 400, got {resp.status_code}")
            return False
        error = resp.json()
        if "lunch already used" not in error.get("error", ""):
            log_fail(f"Expected 'lunch already used' error, got: {error}")
            return False
        log_pass("Correctly blocked lunch re-request even with approvals OFF")
        
        log_pass("SCENARIO C PASSED")
        
        # ========================================================================
        # Scenario D: Area switch after completion
        # ========================================================================
        log("\n--- Scenario D: Area switch after completion ---")
        
        log("Step D.1: Switch to area2")
        resp = requests.patch(f"{BASE_URL}/settings", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={"currentAreaId": area2_id}
        )
        if resp.status_code != 200:
            log_fail(f"Update settings failed: {resp.status_code} {resp.text}")
            return False
        log_pass(f"Switched to area2: {area2_id}")
        
        log("Step D.2: Add employee to area2 roster")
        resp = requests.post(f"{BASE_URL}/rosters", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={
                "areaId": area2_id,
                "date": today,
                "employeeIds": [test_employee["id"]]
            }
        )
        if resp.status_code != 200:
            log_fail(f"Create roster failed: {resp.status_code} {resp.text}")
            return False
        log_pass("Employee added to area2 roster")
        
        # Try to request lunch in area2 - should still fail
        log("Step D.3: Try to request lunch in area2 (should still fail)")
        resp = requests.post(f"{BASE_URL}/breaks/request", 
            headers={"Authorization": f"Bearer {employee_token}"},
            json={"type": "lunch"}
        )
        if resp.status_code != 400:
            log_fail(f"Expected 400, got {resp.status_code}")
            return False
        error = resp.json()
        if "lunch already used" not in error.get("error", ""):
            log_fail(f"Expected 'lunch already used' error, got: {error}")
            return False
        log_pass("Correctly blocked lunch re-request in different area")
        
        log_pass("SCENARIO D PASSED")
        
        log_pass("TEST 2 PASSED: Break lifecycle works correctly across all scenarios")
        return True
        
    except Exception as e:
        log_fail(f"TEST 2 EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

# ============================================================================
# Test 3: DELETE /api/history
# ============================================================================
def test_delete_history():
    global supervisor_token, employee_token
    
    log("\n" + "="*80)
    log("TEST 3: DELETE /api/history")
    log("="*80)
    
    try:
        today = get_today()
        
        # Get history for today
        log("Step 3.1: GET /api/history?date=today")
        resp = requests.get(f"{BASE_URL}/history", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            params={"date": today}
        )
        if resp.status_code != 200:
            log_fail(f"Get history failed: {resp.status_code} {resp.text}")
            return False
        records = resp.json()["records"]
        initial_count = len(records)
        log_pass(f"Found {initial_count} history records for today")
        
        # Delete history for today
        log("Step 3.2: DELETE /api/history?date=today")
        resp = requests.delete(f"{BASE_URL}/history", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            params={"date": today}
        )
        if resp.status_code != 200:
            log_fail(f"Delete history failed: {resp.status_code} {resp.text}")
            return False
        deleted = resp.json()["deleted"]
        if deleted != initial_count:
            log_fail(f"Expected to delete {initial_count} records, got {deleted}")
            return False
        log_pass(f"Deleted {deleted} records")
        
        # Verify history is empty
        log("Step 3.3: GET /api/history?date=today (should be empty)")
        resp = requests.get(f"{BASE_URL}/history", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            params={"date": today}
        )
        if resp.status_code != 200:
            log_fail(f"Get history failed: {resp.status_code} {resp.text}")
            return False
        records = resp.json()["records"]
        if len(records) != 0:
            log_fail(f"Expected 0 records, got {len(records)}")
            return False
        log_pass("History is now empty")
        
        # Try DELETE without params - should fail
        log("Step 3.4: DELETE /api/history without params (should fail)")
        resp = requests.delete(f"{BASE_URL}/history", 
            headers={"Authorization": f"Bearer {supervisor_token}"}
        )
        if resp.status_code != 400:
            log_fail(f"Expected 400, got {resp.status_code}")
            return False
        log_pass("Correctly rejected DELETE without params")
        
        # Try DELETE with all=1
        log("Step 3.5: DELETE /api/history?all=1")
        resp = requests.delete(f"{BASE_URL}/history", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            params={"all": "1"}
        )
        if resp.status_code != 200:
            log_fail(f"Delete all history failed: {resp.status_code} {resp.text}")
            return False
        deleted = resp.json()["deleted"]
        log_pass(f"Deleted {deleted} records with all=1")
        
        # Try DELETE as employee - should fail
        log("Step 3.6: DELETE /api/history as employee (should fail)")
        resp = requests.delete(f"{BASE_URL}/history", 
            headers={"Authorization": f"Bearer {employee_token}"},
            params={"date": today}
        )
        if resp.status_code != 403:
            log_fail(f"Expected 403, got {resp.status_code}")
            return False
        log_pass("Correctly rejected employee DELETE")
        
        log_pass("TEST 3 PASSED: DELETE /api/history works correctly")
        return True
        
    except Exception as e:
        log_fail(f"TEST 3 EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

# ============================================================================
# Test 4: POST /api/areas/{id} route conflict sanity
# ============================================================================
def test_areas_route():
    global supervisor_token, area2_id
    
    log("\n" + "="*80)
    log("TEST 4: POST /api/areas/{id} route conflict sanity")
    log("="*80)
    
    try:
        # PATCH area name
        log("Step 4.1: PATCH /api/areas/{id}")
        resp = requests.patch(f"{BASE_URL}/areas/{area2_id}", 
            headers={"Authorization": f"Bearer {supervisor_token}"},
            json={"name": "Check-in v2"}
        )
        if resp.status_code != 200:
            log_fail(f"PATCH area failed: {resp.status_code} {resp.text}")
            return False
        log_pass("PATCH area successful")
        
        # Verify area was renamed
        log("Step 4.2: GET /api/areas (verify rename)")
        resp = requests.get(f"{BASE_URL}/areas", 
            headers={"Authorization": f"Bearer {supervisor_token}"}
        )
        if resp.status_code != 200:
            log_fail(f"Get areas failed: {resp.status_code} {resp.text}")
            return False
        areas = resp.json()["areas"]
        area2 = next((a for a in areas if a["id"] == area2_id), None)
        if not area2:
            log_fail(f"Area2 not found")
            return False
        if area2["name"] != "Check-in v2":
            log_fail(f"Expected name 'Check-in v2', got '{area2['name']}'")
            return False
        log_pass(f"Area renamed to: {area2['name']}")
        
        log_pass("TEST 4 PASSED: Areas route works correctly")
        return True
        
    except Exception as e:
        log_fail(f"TEST 4 EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

# ============================================================================
# Main
# ============================================================================
def main():
    log("="*80)
    log("ShiftOps Backend Regression Test Suite")
    log(f"Base URL: {BASE_URL}")
    log("="*80)
    
    results = {
        "Test 1: Reset Password": test_reset_password(),
        "Test 2: Break Lifecycle": test_break_lifecycle(),
        "Test 3: Delete History": test_delete_history(),
        "Test 4: Areas Route": test_areas_route(),
    }
    
    log("\n" + "="*80)
    log("TEST SUMMARY")
    log("="*80)
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        log(f"{status}: {test_name}")
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    log(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        log("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        log(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    exit(main())
