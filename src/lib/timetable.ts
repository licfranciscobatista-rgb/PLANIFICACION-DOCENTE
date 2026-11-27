import type { TeacherTimetableEntry } from './model';

export function timetableEntriesForCourse(entries:TeacherTimetableEntry[],courseId:string){
  return entries.filter(entry=>entry.courseId===courseId);
}

export function replaceCourseTimetableEntries(entries:TeacherTimetableEntry[],courseId:string,courseEntries:TeacherTimetableEntry[]){
  return [...entries.filter(entry=>entry.courseId!==courseId),...courseEntries.map(entry=>({...entry,courseId}))];
}

export function suggestTeacherBlock(entries:TeacherTimetableEntry[],courseId:string,date:string,today:string,currentTime:string):number|null{
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay()||7;
  const matches=entries.filter(entry=>entry.courseId===courseId&&entry.weekday===weekday);
 if(matches.length===1)return matches[0]!.block;
 if(date===today){const active=matches.filter(entry=>entry.startTime<=currentTime&&currentTime<entry.endTime);return active.length===1?active[0]!.block:null;}
 return null;
}
