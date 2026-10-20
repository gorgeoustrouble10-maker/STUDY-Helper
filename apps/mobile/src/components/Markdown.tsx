import { Linking, Text, View } from "react-native";
import { colors, s } from "../ui";
function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g)
    .map((part, i) => {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
      if (link)
        return (
          <Text
            key={i}
            accessibilityRole="link"
            style={{ color: colors.green, textDecorationLine: "underline" }}
            onPress={() => void Linking.openURL(link[2])}
          >
            {link[1]}
          </Text>
        );
      if (part.startsWith("**"))
        return (
          <Text key={i} style={{ fontWeight: "700" }}>
            {part.slice(2, -2)}
          </Text>
        );
      if (part.startsWith("`"))
        return (
          <Text
            key={i}
            style={{ fontFamily: "monospace", backgroundColor: colors.pale }}
          >
            {part.slice(1, -1)}
          </Text>
        );
      return part;
    });
}
function parseLines(body:string) {
  let code=false;
  return body.split('\n').map(line=>{
    if(line.startsWith('```')){code=!code;return {line:'',code:false,fence:code?'代码':''};}
    return {line,code,fence:null};
  });
}
export default function Markdown({
  body,
  large = false,
}: {
  body: string;
  large?: boolean;
}) {
  return (
    <View style={{ gap: 9 }}>
      {parseLines(body).map(({line,code,fence}, i) => {
        if (fence!==null) {
          return (
            <Text key={i} style={s.small}>
              {fence}
            </Text>
          );
        }
        if (code)
          return (
            <Text
              key={i}
              selectable
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                color: colors.ink,
                backgroundColor: colors.pale,
                padding: 5,
              }}
            >
              {line || " "}
            </Text>
          );
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
        return (
          <Text
            key={i}
            selectable
            style={[
              s.body,
              large && { fontSize: 19, lineHeight: 32 },
              heading && {
                fontSize: heading[1].length === 1 ? 25 : 20,
                fontWeight: "700",
                marginTop: 8,
              },
            ]}
          >
            {inline(
              heading ? heading[2] : bullet ? `• ${bullet[1]}` : line || " ",
            )}
          </Text>
        );
      })}
    </View>
  );
}
