/** Native Windows security boundary; compiled by the installed .NET Framework, with no package download.
 * APIs: https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer
 * Job lifecycle: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
 */
export const WINDOWS_APPCONTAINER_SOURCE = `
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class ShelraAppContainer {
  [StructLayout(LayoutKind.Sequential)] struct SecurityCapabilities {
    public IntPtr Sid, Capabilities; public uint Count, Reserved;
  }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
    public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
    public int Size; public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public short Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo Startup; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking;
    public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A, B, C, D, E, F; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  public sealed class Result {
    public int ExitCode; public bool TimedOut; public string CleanupError;
  }
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string path, uint access, uint sharing, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static void Require(bool success, string action) {
    if (!success) { int code=Marshal.GetLastWin32Error(); throw new Win32Exception(code, action + ": " + code + " " + new Win32Exception(code).Message); }
  }
  static void Grant(string path, SecurityIdentifier sid, bool writable) {
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Refusing a reparse point: " + path);
    foreach (var child in Directory.EnumerateFileSystemEntries(path)) {
      var attributes = File.GetAttributes(child);
      if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Refusing a reparse point: " + child);
      if ((attributes & FileAttributes.Directory) != 0) CheckTree(child);
    }
    var rights = writable ? FileSystemRights.Modify : FileSystemRights.ReadAndExecute;
    var acl = Directory.GetAccessControl(path);
    acl.AddAccessRule(new FileSystemAccessRule(sid, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    Directory.SetAccessControl(path, acl);
  }
  static void CheckTree(string path) {
    foreach (var child in Directory.EnumerateFileSystemEntries(path)) {
      var attributes = File.GetAttributes(child);
      if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Refusing a reparse point: " + child);
      if ((attributes & FileAttributes.Directory) != 0) CheckTree(child);
    }
  }
  public static string Cleanup(string profile) {
    if (!profile.StartsWith("Shelra.Verify.", StringComparison.Ordinal)) throw new ArgumentException("Invalid verification identity");
    int status = DeleteAppContainerProfile(profile);
    return status < 0 && status != unchecked((int)0x80070002) ? "AppContainer profile cleanup failed: " + status : null;
  }
  static bool Within(string root, string path) {
    return path.Equals(root, StringComparison.OrdinalIgnoreCase) || path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
  }
  static void GrantWritable(string path, SecurityIdentifier sid, string[] protectedPaths) {
    foreach (var protectedPath in protectedPaths) if (Within(protectedPath, path)) return;
    bool ancestor = false;
    foreach (var protectedPath in protectedPaths) if (Within(path, protectedPath)) ancestor = true;
    if (!ancestor) { Grant(path, sid, true); return; }
    // Do not inherit a write grant across the oracle boundary. Our adversarial process probe defeated
    // a package-SID deny layered over the inherited write grant; protection relies on absent write grants.
    // Ancestors may create siblings, but may not delete children or rename themselves.
    var acl = Directory.GetAccessControl(path);
    acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.ReadAndExecute | FileSystemRights.Write, AccessControlType.Allow));
    Directory.SetAccessControl(path, acl);
    foreach (var child in Directory.EnumerateFileSystemEntries(path)) {
      if ((File.GetAttributes(child) & FileAttributes.Directory) != 0) GrantWritable(child, sid, protectedPaths);
      else {
        var fileAcl = File.GetAccessControl(child);
        fileAcl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.Modify, AccessControlType.Allow));
        File.SetAccessControl(child, fileAcl);
      }
    }
  }
  static IntPtr OutputFile(string path, ref SecurityAttributes attributes) {
    var handle = CreateFile(path, 0x40000000, 3, ref attributes, 2, 0x80, IntPtr.Zero);
    if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Create capture file");
    return handle;
  }

  public static Result Run(string profile, string executable, string commandLine, string cwd, string[] readOnly, string[] writable, string[] protectedPaths, string environment, string stdout, string stderr, uint timeout, ulong memoryBytes) {
    if (!profile.StartsWith("Shelra.Verify.", StringComparison.Ordinal)) throw new ArgumentException("Invalid verification identity");
    IntPtr sid = IntPtr.Zero, attrs = IntPtr.Zero, caps = IntPtr.Zero, handles = IntPtr.Zero, env = IntPtr.Zero;
    IntPtr output = IntPtr.Zero, error = IntPtr.Zero, input = IntPtr.Zero, job = IntPtr.Zero;
    ProcessInfo pi = new ProcessInfo(); bool profileCreated = false, attributesInitialized = false;
    Result result = new Result();
    try {
      int status = CreateAppContainerProfile(profile, profile, "Ephemeral Shelra verification", IntPtr.Zero, 0, out sid);
      Marshal.ThrowExceptionForHR(status); profileCreated = true;
      var identity = new SecurityIdentifier(sid);
      foreach (string path in readOnly) Grant(path, identity, false);
      foreach (string path in writable) {
        Grant(path, identity, false);
        GrantWritable(path, identity, protectedPaths);
      }
      var sa = new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)), Inherit=true };
      output = OutputFile(stdout, ref sa); error = OutputFile(stderr, ref sa);
      input = CreateFile("NUL", 0x80000000, 3, ref sa, 3, 0, IntPtr.Zero);
      if (input == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Open null input");
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
      if (size == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Size attributes");
      attrs = Marshal.AllocHGlobal(size);
      Require(InitializeProcThreadAttributeList(attrs, 2, 0, ref size), "Initialize attributes"); attributesInitialized = true;
      var security = new SecurityCapabilities { Sid=sid };
      caps = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecurityCapabilities)));
      Marshal.StructureToPtr(security, caps, false);
      Require(UpdateProcThreadAttribute(attrs, 0, new IntPtr(0x20009), caps, new IntPtr(Marshal.SizeOf(typeof(SecurityCapabilities))), IntPtr.Zero, IntPtr.Zero), "Set AppContainer capabilities");
      handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.WriteIntPtr(handles, 0, input); Marshal.WriteIntPtr(handles, IntPtr.Size, output); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, error);
      Require(UpdateProcThreadAttribute(attrs, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero), "Restrict inherited handles");
      var startup = new StartupInfoEx(); startup.Startup.Size = Marshal.SizeOf(typeof(StartupInfoEx));
      startup.Startup.Flags=0x100; startup.Startup.Input=input; startup.Startup.Output=output; startup.Startup.Error=error; startup.Attributes=attrs;
      env = Marshal.StringToHGlobalUni(environment);
      job = CreateJobObject(IntPtr.Zero, null);
      Require(job != IntPtr.Zero, "Create process job");
      var limits = new ExtendedLimits(); limits.Basic.Flags=0x2000 | 0x400 | 0x8; limits.Basic.ActiveProcesses=32; limits.JobMemory=new UIntPtr(memoryBytes);
      Require(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "Set memory and kill-on-close limits");
      Require(CreateProcess(executable, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 0x400 | 0x4 | 0x8000000, env, cwd, ref startup, out pi), "Create isolated process");
      Require(AssignProcessToJobObject(job, pi.Process), "Assign isolated process to job");
      Require(ResumeThread(pi.Thread) != 0xffffffff, "Resume isolated process");
      var started = DateTime.UtcNow;
      while (true) {
        uint waited = WaitForSingleObject(pi.Process, 100);
        if (waited == 0) break;
        if (waited != 258) throw new Win32Exception(Marshal.GetLastWin32Error(), "Wait for isolated process");
        if ((DateTime.UtcNow - started).TotalMilliseconds >= timeout) {
          Require(TerminateJobObject(job, 124), "Terminate timed-out job"); result.TimedOut=true;
          WaitForSingleObject(pi.Process, 5000); break;
        }
        if (new FileInfo(stdout).Length + new FileInfo(stderr).Length > 128L * 1024 * 1024) {
          Require(TerminateJobObject(job, 125), "Terminate output overflow");
          throw new IOException("Isolated process exceeded its output budget.");
        }
      }
      uint code; Require(GetExitCodeProcess(pi.Process, out code), "Read isolated exit code"); result.ExitCode=unchecked((int)code);
    } finally {
      // Even a failure between CreateProcess and job assignment must not leave a suspended process.
      if (pi.Process != IntPtr.Zero) TerminateProcess(pi.Process, 126);
      if (job != IntPtr.Zero) { TerminateJobObject(job, 126); CloseHandle(job); }
      if (pi.Thread != IntPtr.Zero) CloseHandle(pi.Thread);
      if (pi.Process != IntPtr.Zero) { WaitForSingleObject(pi.Process, 5000); CloseHandle(pi.Process); }
      foreach (var handle in new[] { input, output, error }) if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
      if (attributesInitialized) DeleteProcThreadAttributeList(attrs);
      foreach (var allocation in new[] { attrs, caps, handles, env }) if (allocation != IntPtr.Zero) Marshal.FreeHGlobal(allocation);
      if (sid != IntPtr.Zero) FreeSid(sid);
      if (profileCreated) result.CleanupError=Cleanup(profile);
    }
    return result;
  }
}
`;
