# R8 rules
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class com.ninejaride.driver.data.** { kotlinx.serialization.KSerializer serializer(...); }
