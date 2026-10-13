# Holds the configured scan-code key, repeating down events without releasing.
# No recovery pulses or keyboard hooks react to other keys.
# Runs independently of the audio player so killing audio cannot strand a key.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
public static class GiroPttGuard {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint msg; public ushort low,high; }
  [StructLayout(LayoutKind.Explicit)] struct UNION {
    [FieldOffset(0)] public KEYBDINPUT key;
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public HARDWAREINPUT hardware;
  }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs,int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code,uint mode);
  static void Send(int vk,bool up) {
    uint extended=(vk>=0x21 && vk<=0x28) || vk==0x2D || vk==0x2E ? 1u:0u;
    INPUT input=new INPUT();input.type=1;
    input.data.key=new KEYBDINPUT {vk=0,scan=(ushort)MapVirtualKey((uint)vk,0),flags=8u|extended|(up?2u:0u)};
    if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)
      throw new InvalidOperationException("Windows rejected the PTT key event. Check application privileges.");
  }
  public static void Run(int parentPid) {
    HashSet<int> held=new HashSet<int>();
    Stopwatch repeatClock=Stopwatch.StartNew();
    long nextRepeat=0;
    try {
      using(Process parent=Process.GetProcessById(parentPid)) {
        Console.WriteLine("PTT_READY");Console.Out.Flush();
        Task<string> read=Task.Factory.StartNew(() => Console.In.ReadLine());
        while(!parent.HasExited) {
          if(read.IsCompleted) {
            string command=read.GetAwaiter().GetResult();
            if(command==null || command=="EXIT")break;
            if(command=="UP") {
              foreach(int key in held)Send(key,true);held.Clear();
              Console.WriteLine("KEY_UP");Console.Out.Flush();
            } else if(command.StartsWith("UP:")) {
              int vk;
              if(!Int32.TryParse(command.Substring(3),out vk) || vk<1 || vk>255)throw new InvalidOperationException("Invalid PTT key.");
              if(held.Contains(vk)){Send(vk,true);held.Remove(vk);}
              Console.WriteLine("KEY_UP");Console.Out.Flush();
            } else if(command.StartsWith("DOWN:")) {
              int vk;
              if(!Int32.TryParse(command.Substring(5),out vk) || vk<1 || vk>255)throw new InvalidOperationException("Invalid PTT key.");
              if(!held.Contains(vk)){Send(vk,false);held.Add(vk);nextRepeat=repeatClock.ElapsedMilliseconds+33;}
              Console.WriteLine("KEY_DOWN");Console.Out.Flush();
            }
            read=Task.Factory.StartNew(() => Console.In.ReadLine());
          }
          // Repeat key-down only. The configured key stays down throughout
          // playback; repeats never insert key-up events.
          if(held.Count>0 && repeatClock.ElapsedMilliseconds>=nextRepeat) {
            foreach(int key in held)Send(key,false);
            nextRepeat=repeatClock.ElapsedMilliseconds+33;
          }
          Thread.Sleep(5);
        }
      }
    } catch(Exception error) {
      Console.WriteLine("ERROR:"+error.Message);Console.Out.Flush();
    } finally {
      foreach(int key in held)try{Send(key,true);}catch(Exception error){Console.Error.WriteLine(error.Message);}
    }
  }
}
'@
[GiroPttGuard]::Run([int]$env:GIRO_PARENT_PID)
