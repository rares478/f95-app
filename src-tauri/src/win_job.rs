//! Windows Job Objects helpers for reliable child-process teardown.
//!
//! `CREATE_NO_WINDOW` sidecars are not in the console process group, so Ctrl+C
//! on `tauri dev` kills `f95-app.exe` (`STATUS_CONTROL_C_EXIT`) without
//! delivering a clean shutdown to Node. Holding a job with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` means: when our process dies and the
//! job handle closes, Windows terminates every process still in the job
//! (sidecar Node + Playwright browsers).

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

/// Owns a job handle configured with kill-on-close.
pub struct KillOnCloseJob(HANDLE);

// HANDLE is just a pointer; the job is process-local and safe to move/share
// across threads while we exclusively own the close/terminate side.
unsafe impl Send for KillOnCloseJob {}
unsafe impl Sync for KillOnCloseJob {}

impl KillOnCloseJob {
    /// Create a kill-on-close job and assign the process `pid` to it.
    /// Returns `None` if the OS rejects the assignment (e.g. nested-job limits).
    pub fn attach_pid(pid: u32) -> Option<Self> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
            .is_err()
            {
                let _ = CloseHandle(job);
                return None;
            }

            let process =
                match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                    Ok(h) => h,
                    Err(_) => {
                        let _ = CloseHandle(job);
                        return None;
                    }
                };

            let assigned = AssignProcessToJobObject(job, process);
            let _ = CloseHandle(process);
            if assigned.is_err() {
                let _ = CloseHandle(job);
                return None;
            }

            Some(Self(job))
        }
    }

    /// Terminate every process currently in the job (Node + Playwright tree).
    pub fn terminate(&self) {
        unsafe {
            let _ = TerminateJobObject(self.0, 1);
        }
    }
}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // Closing the last handle with KILL_ON_JOB_CLOSE also kills members.
        // Terminate first so teardown does not wait on graceful Node exit.
        self.terminate();
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
