async function fn(){
    try{
        await 1
        setTimeout(()=>{
            throw Error(1)
        },100)
    }catch(e){
        console.log(e);
    }finally{
        console.log("fin")
        return "fin"
    }
    return 10
}
fn().then((r)=>{
    console.log(r);
})


// const x = new Promise((resolve, reject) => {
//     resolve(10)
// })
// x.then((r)=>{
//     return 10
// }).finally(()=>{
//     return "fin"
// }).then((r)=>{
//     console.log(r);
// })